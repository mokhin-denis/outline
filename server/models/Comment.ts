import { Node } from "prosemirror-model";
import {
  InferAttributes,
  InferCreationAttributes,
  SaveOptions,
} from "sequelize";
import {
  DataType,
  BelongsTo,
  ForeignKey,
  Column,
  Table,
  Length,
  DefaultScope,
} from "sequelize-typescript";
import type { ProsemirrorData } from "@shared/types";
import { ProsemirrorHelper } from "@shared/utils/ProsemirrorHelper";
import { CommentValidation } from "@shared/validations";
import { schema } from "@server/editor";
import { ValidationError } from "@server/errors";
import Document from "./Document";
import User from "./User";
import ParanoidModel from "./base/ParanoidModel";
import Fix from "./decorators/Fix";
import TextLength from "./validators/TextLength";

@DefaultScope(() => ({
  include: [
    {
      model: User,
      as: "createdBy",
      paranoid: false,
    },
    {
      model: User,
      as: "resolvedBy",
      paranoid: false,
    },
  ],
}))
@Table({ tableName: "comments", modelName: "comment" })
@Fix
class Comment extends ParanoidModel<
  InferAttributes<Comment>,
  Partial<InferCreationAttributes<Comment>>
> {
  @TextLength({
    max: CommentValidation.maxLength,
    msg: `Comment must be less than ${CommentValidation.maxLength} characters`,
  })
  @Length({
    max: CommentValidation.maxLength * 10,
    msg: `Comment data is too large`,
  })
  @Column(DataType.JSONB)
  data: ProsemirrorData;

  // associations

  @BelongsTo(() => User, "createdById")
  createdBy: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  createdById: string;

  @BelongsTo(() => User, "resolvedById")
  resolvedBy: User | null;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  resolvedById: string | null;

  @BelongsTo(() => Document, "documentId")
  document: Document;

  @ForeignKey(() => Document)
  @Column(DataType.UUID)
  documentId: string;

  @BelongsTo(() => Comment, "parentCommentId")
  parentComment: Comment;

  @ForeignKey(() => Comment)
  @Column(DataType.UUID)
  parentCommentId: string;

  // methods

  /**
   * Resolve the comment
   *
   * @param resolvedBy The user who resolved the comment
   * @param options The save options
   */
  public resolve(
    resolvedBy: User,
    options?: SaveOptions<InferAttributes<Comment>>
  ) {
    if (this.resolvedById) {
      throw ValidationError("Comment is already resolved");
    }
    if (this.parentCommentId) {
      throw ValidationError("Cannot resolve a reply");
    }

    this.resolvedById = resolvedBy.id;
    this.resolvedBy = resolvedBy;
    return this.save(options);
  }

  /**
   * Unresolve the comment
   *
   * @param options The save options
   */
  public unresolve(options?: SaveOptions<InferAttributes<Comment>>) {
    if (!this.resolvedById) {
      throw ValidationError("Comment is not resolved");
    }

    this.resolvedById = null;
    this.resolvedBy = null;
    return this.save(options);
  }

  /**
   * Convert the comment data to plain text
   *
   * @returns The plain text representation of the comment data
   */
  public toPlainText() {
    const node = Node.fromJSON(schema, this.data);
    return ProsemirrorHelper.toPlainText(node, schema);
  }
}

export default Comment;
