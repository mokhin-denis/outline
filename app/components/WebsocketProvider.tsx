import invariant from "invariant";
import find from "lodash/find";
import { action, observable } from "mobx";
import { observer } from "mobx-react";
import * as React from "react";
import { withTranslation, WithTranslation } from "react-i18next";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";
import { FileOperationState, FileOperationType } from "@shared/types";
import RootStore from "~/stores/RootStore";
import Collection from "~/models/Collection";
import Comment from "~/models/Comment";
import Document from "~/models/Document";
import FileOperation from "~/models/FileOperation";
import Group from "~/models/Group";
import GroupMembership from "~/models/GroupMembership";
import GroupUser from "~/models/GroupUser";
import Membership from "~/models/Membership";
import Notification from "~/models/Notification";
import Pin from "~/models/Pin";
import Star from "~/models/Star";
import Subscription from "~/models/Subscription";
import Team from "~/models/Team";
import User from "~/models/User";
import UserMembership from "~/models/UserMembership";
import withStores from "~/components/withStores";
import {
  PartialWithId,
  WebsocketCollectionUpdateIndexEvent,
  WebsocketEntitiesEvent,
  WebsocketEntityDeletedEvent,
} from "~/types";
import { AuthorizationError, NotFoundError } from "~/utils/errors";
import { getVisibilityListener, getPageVisible } from "~/utils/pageVisibility";

type SocketWithAuthentication = Socket & {
  authenticated?: boolean;
};

export const WebsocketContext =
  React.createContext<SocketWithAuthentication | null>(null);

type Props = WithTranslation & RootStore;

@observer
class WebsocketProvider extends React.Component<Props> {
  @observable
  socket: SocketWithAuthentication | null;

  componentDidMount() {
    this.createConnection();
    document.addEventListener(getVisibilityListener(), this.checkConnection);
  }

  componentWillUnmount() {
    if (this.socket) {
      this.socket.authenticated = false;
      this.socket.disconnect();
    }

    document.removeEventListener(getVisibilityListener(), this.checkConnection);
  }

  checkConnection = () => {
    if (this.socket?.disconnected && getPageVisible()) {
      // null-ifying this reference is important, do not remove. Without it
      // references to old sockets are potentially held in context
      this.socket.close();
      this.socket = null;
      this.createConnection();
    }
  };

  createConnection = () => {
    this.socket = io(window.location.origin, {
      path: "/realtime",
      transports: ["websocket"],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      withCredentials: true,
    });
    invariant(this.socket, "Socket should be defined");

    this.socket.authenticated = false;
    const {
      auth,
      documents,
      collections,
      groups,
      groupUsers,
      groupMemberships,
      pins,
      stars,
      memberships,
      users,
      userMemberships,
      policies,
      comments,
      subscriptions,
      fileOperations,
      notifications,
    } = this.props;

    const currentUserId = auth?.user?.id;

    // on reconnection, reset the transports option, as the Websocket
    // connection may have failed (caused by proxy, firewall, browser, ...)
    this.socket.io.on("reconnect_attempt", () => {
      if (this.socket) {
        this.socket.io.opts.transports = auth?.team?.domain
          ? ["websocket"]
          : ["websocket", "polling"];
      }
    });

    this.socket.on("authenticated", () => {
      if (this.socket) {
        this.socket.authenticated = true;
      }
    });

    this.socket.on("unauthorized", (err: Error) => {
      if (this.socket) {
        this.socket.authenticated = false;
      }
      toast.error(err.message);
      throw err;
    });

    this.socket.on(
      "entities",
      action(async (event: WebsocketEntitiesEvent) => {
        if (event.documentIds) {
          for (const documentDescriptor of event.documentIds) {
            const documentId = documentDescriptor.id;
            let document = documents.get(documentId);
            const previousTitle = document?.title;

            // if we already have the latest version (it was us that performed
            // the change) then we don't need to update anything either.
            if (document?.updatedAt === documentDescriptor.updatedAt) {
              continue;
            }
            if (!document && !event.fetchIfMissing) {
              continue;
            }

            // otherwise, grab the latest version of the document
            try {
              document = await documents.fetch(documentId, {
                force: true,
              });
            } catch (err) {
              if (
                err instanceof AuthorizationError ||
                err instanceof NotFoundError
              ) {
                documents.remove(documentId);
                return;
              }
            }

            // if the title changed then we need to update the collection also
            if (document && previousTitle !== document.title) {
              if (!event.collectionIds) {
                event.collectionIds = [];
              }

              const existing = find(event.collectionIds, {
                id: document.collectionId,
              });

              if (!existing && document.collectionId) {
                event.collectionIds.push({
                  id: document.collectionId,
                });
              }
            }
          }
        }

        if (event.collectionIds) {
          for (const collectionDescriptor of event.collectionIds) {
            const collectionId = collectionDescriptor.id;
            const collection = collections.get(collectionId);

            // if we already have the latest version (it was us that performed
            // the change) then we don't need to update anything either.
            if (collection?.updatedAt === collectionDescriptor.updatedAt) {
              continue;
            }
            if (!collection?.documents?.length && !event.fetchIfMissing) {
              continue;
            }

            try {
              await collection?.fetchDocuments({
                force: true,
              });
            } catch (err) {
              if (
                err instanceof AuthorizationError ||
                err instanceof NotFoundError
              ) {
                memberships.removeAll({ collectionId });
                collections.remove(collectionId);
                return;
              }
            }
          }
        }
      })
    );

    this.socket.on(
      "documents.update",
      action(
        (event: PartialWithId<Document> & { title: string; url: string }) => {
          documents.add(event);

          if (event.collectionId) {
            const collection = collections.get(event.collectionId);
            collection?.updateDocument(event);
          }
        }
      )
    );

    this.socket.on(
      "documents.archive",
      action((event: PartialWithId<Document>) => {
        documents.addToArchive(event);

        if (event.collectionId) {
          const collection = collections.get(event.collectionId);
          collection?.removeDocument(event.id);
        }
      })
    );

    this.socket.on(
      "documents.delete",
      action((event: PartialWithId<Document>) => {
        documents.add(event);
        policies.remove(event.id);

        if (event.collectionId) {
          const collection = collections.get(event.collectionId);
          collection?.removeDocument(event.id);
        }

        userMemberships.orderedData
          .filter((m) => m.documentId === event.id)
          .forEach((m) => userMemberships.remove(m.id));
      })
    );

    this.socket.on(
      "documents.permanent_delete",
      (event: WebsocketEntityDeletedEvent) => {
        documents.remove(event.modelId);
      }
    );

    this.socket.on("documents.add_user", async (event: UserMembership) => {
      userMemberships.add(event);

      // Any existing child policies are now invalid
      if (event.userId === currentUserId) {
        const document = documents.get(event.documentId!);
        if (document) {
          document.childDocuments.forEach((childDocument) => {
            policies.remove(childDocument.id);
          });
        }
      }

      await documents.fetch(event.documentId!, {
        force: event.userId === currentUserId,
      });
    });

    this.socket.on("documents.remove_user", (event: UserMembership) => {
      userMemberships.remove(event.id);

      // Any existing child policies are now invalid
      if (event.userId === currentUserId) {
        const document = documents.get(event.documentId!);
        if (document) {
          document.childDocuments.forEach((childDocument) => {
            policies.remove(childDocument.id);
          });
        }
      }

      const policy = policies.get(event.documentId!);
      if (policy && policy.abilities.read === false) {
        documents.remove(event.documentId!);
      }
    });

    this.socket.on("comments.create", (event: PartialWithId<Comment>) => {
      comments.add(event);
    });

    this.socket.on("comments.update", (event: PartialWithId<Comment>) => {
      comments.add(event);
    });

    this.socket.on("comments.delete", (event: WebsocketEntityDeletedEvent) => {
      comments.remove(event.modelId);
    });

    this.socket.on("groups.create", (event: PartialWithId<Group>) => {
      groups.add(event);
    });

    this.socket.on("groups.update", (event: PartialWithId<Group>) => {
      groups.add(event);
    });

    this.socket.on("groups.delete", (event: WebsocketEntityDeletedEvent) => {
      groups.remove(event.modelId);
    });

    this.socket.on("groups.add_user", (event: PartialWithId<GroupUser>) => {
      groupUsers.add(event);
    });

    this.socket.on("groups.remove_user", (event: GroupUser) => {
      groupUsers.removeAll({ groupId: event.groupId, userId: event.userId });
    });

    this.socket.on("collections.create", (event: PartialWithId<Collection>) => {
      collections.add(event);
    });

    this.socket.on("collections.update", (event: PartialWithId<Collection>) => {
      collections.add(event);
    });

    this.socket.on(
      "collections.delete",
      action((event: WebsocketEntityDeletedEvent) => {
        const collectionId = event.modelId;
        const deletedAt = new Date().toISOString();
        const deletedDocuments = documents.inCollection(collectionId);
        deletedDocuments.forEach((doc) => {
          if (!doc.publishedAt) {
            // draft is to be detached from collection, not deleted
            doc.collectionId = null;
          } else {
            doc.deletedAt = deletedAt;
          }
          policies.remove(doc.id);
        });
        memberships.removeAll({ collectionId });
        collections.remove(collectionId);
      })
    );

    this.socket.on("teams.update", (event: PartialWithId<Team>) => {
      if ("sharing" in event && event.sharing !== auth.team?.sharing) {
        documents.all.forEach((document) => {
          policies.remove(document.id);
        });
      }

      auth.team?.updateData(event);
    });

    this.socket.on(
      "notifications.create",
      (event: PartialWithId<Notification>) => {
        notifications.add(event);
      }
    );

    this.socket.on(
      "notifications.update",
      (event: PartialWithId<Notification>) => {
        notifications.add(event);
      }
    );

    this.socket.on("pins.create", (event: PartialWithId<Pin>) => {
      pins.add(event);
    });

    this.socket.on("pins.update", (event: PartialWithId<Pin>) => {
      pins.add(event);
    });

    this.socket.on("pins.delete", (event: WebsocketEntityDeletedEvent) => {
      pins.remove(event.modelId);
    });

    this.socket.on("stars.create", (event: PartialWithId<Star>) => {
      stars.add(event);
    });

    this.socket.on("stars.update", (event: PartialWithId<Star>) => {
      stars.add(event);
    });

    this.socket.on("stars.delete", (event: WebsocketEntityDeletedEvent) => {
      stars.remove(event.modelId);
    });

    this.socket.on(
      "user.typing",
      (event: { userId: string; documentId: string; commentId: string }) => {
        comments.setTyping(event);
      }
    );

    this.socket.on("collections.add_user", async (event: Membership) => {
      memberships.add(event);
      await collections.fetch(event.collectionId, {
        force: event.userId === currentUserId,
      });
    });

    this.socket.on("collections.remove_user", (event: Membership) => {
      memberships.remove(event.id);

      const policy = policies.get(event.collectionId);
      if (policy && policy.abilities.read === false) {
        collections.remove(event.collectionId);
      }
    });

    this.socket.on("collections.add_group", async (event: GroupMembership) => {
      groupMemberships.add(event);
      await collections.fetch(event.collectionId!);
    });

    this.socket.on(
      "collections.remove_group",
      async (event: GroupMembership) => {
        groupMemberships.remove(event.id);

        const policy = policies.get(event.collectionId!);
        if (policy && policy.abilities.read === false) {
          collections.remove(event.collectionId!);
        }
      }
    );

    this.socket.on(
      "collections.update_index",
      action((event: WebsocketCollectionUpdateIndexEvent) => {
        const collection = collections.get(event.collectionId);
        collection?.updateIndex(event.index);
      })
    );

    this.socket.on(
      "fileOperations.create",
      (event: PartialWithId<FileOperation>) => {
        fileOperations.add(event);
      }
    );

    this.socket.on(
      "fileOperations.update",
      (event: PartialWithId<FileOperation>) => {
        fileOperations.add(event);

        if (
          event.state === FileOperationState.Complete &&
          event.type === FileOperationType.Import &&
          event.user?.id === auth.user?.id
        ) {
          toast.success(event.name, {
            description: this.props.t("Your import completed"),
          });
        }
      }
    );

    this.socket.on(
      "subscriptions.create",
      (event: PartialWithId<Subscription>) => {
        subscriptions.add(event);
      }
    );

    this.socket.on(
      "subscriptions.delete",
      (event: WebsocketEntityDeletedEvent) => {
        subscriptions.remove(event.modelId);
      }
    );

    this.socket.on("users.update", (event: PartialWithId<User>) => {
      users.add(event);
    });

    this.socket.on("users.demote", async (event: PartialWithId<User>) => {
      if (event.id === auth.user?.id) {
        documents.all.forEach((document) => policies.remove(document.id));
        await collections.fetchAll();
      }
    });

    this.socket.on(
      "userMemberships.update",
      async (event: PartialWithId<UserMembership>) => {
        userMemberships.add(event);
      }
    );

    // received a message from the API server that we should request
    // to join a specific room. Forward that to the ws server.
    this.socket.on("join", (event) => {
      this.socket?.emit("join", event);
    });

    // received a message from the API server that we should request
    // to leave a specific room. Forward that to the ws server.
    this.socket.on("leave", (event) => {
      this.socket?.emit("leave", event);
    });
  };

  render() {
    return (
      <WebsocketContext.Provider value={this.socket}>
        {this.props.children}
      </WebsocketContext.Provider>
    );
  }
}

export default withTranslation()(withStores(WebsocketProvider));
