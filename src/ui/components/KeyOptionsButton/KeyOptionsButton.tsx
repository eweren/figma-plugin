import { h } from "preact";

import styles from "./KeyOptionsButton.css";
import { Edit, More, MyLocation } from "@/ui/icons/SvgIcons";
import { useMemo, useRef } from "preact/hooks";
import Popover from "../Popover/Popover";
import { useHighlightNodeMutation } from "../../hooks/useHighlightNodeMutation";
import { useGlobalActions } from "../../state/GlobalState";
import { NodeInfo } from "../../../types";
import { useEditorMode } from "../../hooks/useEditorMode";

type Props = {
  node: NodeInfo;
};

export const KeyOptionsButton = ({ node }: Props) => {
  const moreOptionsRef = useRef<HTMLDivElement>(null);

  const highlightMutation = useHighlightNodeMutation();
  const { setRoute } = useGlobalActions();

  const handleHighlight = () => {
    highlightMutation.mutate({ id: node.id });
  };

  const editorMode = useEditorMode();

  const stringDetailsOption = useMemo(
    () => ({
      cy: "string_details_cy",
      label: "String details",
      icon: <Edit width={16} height={16} />,
      onClick: () => {
        setRoute("string_details", { node });
      },
    }),
    [node, setRoute]
  );

  const moveToStringOption = {
    label: "Move to String",
    icon: <MyLocation width={16} height={16} />,
    onClick: () => {
      handleHighlight();
    },
  };

  return (
    <div
      data-cy="key_options_button"
      role="button"
      title="Locate on the page"
      ref={moreOptionsRef}
      className={styles.highlightButton}
    >
      <More width={16} height={16} />
      <Popover
        popoverTrigger={moreOptionsRef}
        items={
          editorMode.data === "dev"
            ? [moveToStringOption]
            : [
                stringDetailsOption,
                moveToStringOption,
                // TODO: implement ignore string
                // {
                //   label: "Ignore String",
                //   icon: <X width={16} height={16} />,
                //   onClick: () => {
                //     console.log("Ignore String");
                //   },
                // },
              ]
        }
      />
    </div>
  );
};
