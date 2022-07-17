import * as React from "react";
import { useTranslation } from "react-i18next";
import { useMenuState, MenuButton } from "reakit/Menu";
import styled from "styled-components";
import Button, { Inner } from "~/components/Button";
import ContextMenu from "~/components/ContextMenu";
import MenuItem from "~/components/ContextMenu/MenuItem";
import Text from "~/components/Text";
import { Outline } from "./Input";
import InputSearch from "./InputSearch";
import PaginatedList, { PaginatedItem } from "./PaginatedList";

type TFilterOption = PaginatedItem & {
  key: string;
  label: string;
  note?: string;
};

type Props = {
  options: TFilterOption[];
  activeKey: string | null | undefined;
  defaultLabel?: string;
  selectedPrefix?: string;
  className?: string;
  onSelect: (key: string | null | undefined) => void;
  search?: (query: string) => Promise<TFilterOption[]>;
  paginateFetch?: (
    options: PaginatedItem
  ) => Promise<PaginatedItem[] | undefined>;
};

const FilterOptions = ({
  options,
  activeKey = "",
  defaultLabel,
  selectedPrefix = "",
  className,
  onSelect,
  search,
  paginateFetch,
}: Props) => {
  const { t } = useTranslation();
  const tDefaultLabel: string = defaultLabel ?? t("Filter options");
  const menu = useMenuState({
    modal: true,
  });

  const [filteredOptions, setFilteredOptions] = React.useState<TFilterOption[]>(
    []
  );

  React.useEffect(() => {
    setFilteredOptions(options);
  }, [options]);

  const selected =
    options.find((option) => option.key === activeKey) || options[0];

  const selectedLabel = selected ? `${selectedPrefix} ${selected.label}` : "";

  const clearFilter = React.useCallback(() => {
    setFilteredOptions(options);
  }, [options]);

  // Simple case-insensitive filter to
  // check if text appears in any author's name.
  const handleFilter = React.useCallback(
    async (event) => {
      const { value } = event.target;
      if (value) {
        const res = options.filter((option) =>
          option.label.toLowerCase().includes(value.toLowerCase())
        );

        if (search) {
          const more = await search(value);
          const missing = more.filter(
            (item) => !res.map((r) => r.key).includes(item.key)
          );
          setFilteredOptions([...missing, ...res]);
        } else {
          setFilteredOptions(res);
        }
      } else {
        // Clears filter options cache.
        // This part fires off when search term is "".
        // Either by user clearing it entirely or
        // by deleting one character at a time,
        // gradually decreasing relevance.
        clearFilter();
      }
    },
    [clearFilter, options, search]
  );

  const renderItem = React.useCallback(
    (option: TFilterOption) => (
      <MenuItem
        key={option.key}
        onClick={() => {
          onSelect(option.key);
          menu.hide();
        }}
        selected={option.key === activeKey}
        {...menu}
      >
        {option.note ? (
          <LabelWithNote>
            {option.label}
            <Note>{option.note}</Note>
          </LabelWithNote>
        ) : (
          option.label
        )}
      </MenuItem>
    ),
    [activeKey, activeKey, onSelect]
  );

  return (
    <Wrapper>
      <MenuButton {...menu} onClick={clearFilter}>
        {(props) => (
          <StyledButton {...props} className={className} neutral disclosure>
            {activeKey ? selectedLabel : tDefaultLabel}
          </StyledButton>
        )}
      </MenuButton>
      <ContextMenu aria-label={tDefaultLabel} {...menu}>
        {search && (
          <>
            <StyledInputSearch onChange={handleFilter} autoFocus />
            <br />
          </>
        )}
        <PaginatedList
          items={filteredOptions}
          fetch={paginateFetch}
          renderItem={renderItem}
        />
      </ContextMenu>
    </Wrapper>
  );
};

const Note = styled(Text)`
  margin-top: 2px;
  margin-bottom: 0;
  line-height: 1.2em;
  font-size: 14px;
  font-weight: 400;
  color: ${(props) => props.theme.textTertiary};
`;

const LabelWithNote = styled.div`
  font-weight: 500;
  text-align: left;

  &:hover ${Note} {
    color: ${(props) => props.theme.white50};
  }
`;

const StyledButton = styled(Button)`
  box-shadow: none;
  text-transform: none;
  border-color: transparent;
  height: auto;

  &:hover {
    background: transparent;
  }

  ${Inner} {
    line-height: 24px;
    min-height: auto;
  }
`;

const Wrapper = styled.div`
  margin-right: 8px;
`;

// `position: sticky` leaves a bit of space above the search box,
// which shows author names moving past behind it.
const StyledInputSearch = styled(InputSearch)`
  position: absolute;
  width: 100%;
  border: none;
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
  overflow: hidden;
  top: 0;
  z-index: 1;

  ${Outline} {
    border-top-style: unset;
    border-right-style: unset;
    border-left-style: unset;
    border-radius: unset;
    border-bottom: 1px solid ${(props) => props.theme.divider};
    background: ${(props) => props.theme.menuBackground};
    font-size: 14px;

    input {
      margin-left: 8px;
    }
  }
`;

export default FilterOptions;
