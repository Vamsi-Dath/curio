import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import styles from "./ModalShell.module.css";

interface ModalShellProps {
  onClose: () => void;
  children: React.ReactNode;
  size?: "default" | "large";
}

export default function ModalShell({ onClose, children, size = "default" }: ModalShellProps) {
  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={`${styles.modal}${size === "large" ? ` ${styles.large}` : ""}`}>
        <button className={styles.closeX} onClick={onClose} aria-label="Close">
          <FontAwesomeIcon icon={faXmark} />
        </button>
        {children}
      </div>
    </>
  );
}
