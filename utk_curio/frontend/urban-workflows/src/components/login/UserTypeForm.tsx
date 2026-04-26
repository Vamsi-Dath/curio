import React, { useCallback, useState } from "react";
import content from "../modal-content.module.css";
import styles from "./UserTypeForm.module.css";
import { useUserContext } from "../../providers/UserProvider";
import { useDialogContext } from "../../providers/DialogProvider";

export const UserTypeForm = () => {
  const { unsetDialog } = useDialogContext();
  const { saveUserType } = useUserContext();
  const [type, setType] = useState<"expert" | "programmer" | null>("programmer");

  const types: { id: number; name: "expert" | "programmer" }[] = [
    { id: 1, name: "expert" },
    { id: 2, name: "programmer" },
  ];

  const handleSave = useCallback(async () => {
    if (!type) return;
    await saveUserType(type);
    unsetDialog();
  }, [type]);

  return (
    <div className={content.content}>
      <h2 className={content.title}>Welcome to our platform!</h2>
      <p className={content.subtitle}>Which professional are you?</p>

      <div className={styles.toggleGroup}>
        {types.map((t) => (
          <button
            key={t.id}
            className={`${styles.toggleBtn}${type === t.name ? ` ${styles.toggleBtnActive}` : ""}`}
            onClick={() => setType(t.name)}
            type="button"
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className={content.buttonRow}>
        <button
          className={content.primaryButton}
          disabled={!type}
          onClick={handleSave}
        >
          Save
        </button>
      </div>
    </div>
  );
};
