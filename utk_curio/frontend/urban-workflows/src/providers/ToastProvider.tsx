import React, { createContext, useState, useContext, useCallback, ReactNode } from "react";
import { Toast } from "react-bootstrap";

export type ToastVariant = "error" | "warning" | "info" | "success";

interface ToastItem {
    id: number;
    message: string;
    variant: ToastVariant;
}

interface ToastContextValue {
    showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _nextId = 0;

const VARIANT_BG: Record<ToastVariant, string> = {
    error: "#c0392b",
    warning: "#e8a838",
    success: "#27ae60",
    info: "#2980b9",
};

const VARIANT_TITLE: Record<ToastVariant, string> = {
    error: "Error",
    warning: "Warning",
    success: "Success",
    info: "Info",
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const showToast = useCallback((message: string, variant: ToastVariant = "error") => {
        const id = _nextId++;
        setToasts((prev) => [...prev, { id, message, variant }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 5000);
    }, []);

    const dismiss = useCallback((id: number) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <div
                style={{
                    position: "fixed",
                    bottom: "20px",
                    right: "20px",
                    zIndex: 10000,
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    maxWidth: "360px",
                }}
            >
                {toasts.map((toast) => (
                    <Toast
                        key={toast.id}
                        show
                        onClose={() => dismiss(toast.id)}
                        style={{
                            backgroundColor: VARIANT_BG[toast.variant],
                            color: "white",
                            border: "none",
                            borderRadius: "6px",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
                            minWidth: "260px",
                        }}
                    >
                        <Toast.Header
                            style={{
                                backgroundColor: "rgba(0,0,0,0.15)",
                                color: "white",
                                border: "none",
                                borderRadius: "6px 6px 0 0",
                            }}
                        >
                            <strong className="me-auto">
                                {VARIANT_TITLE[toast.variant]}
                            </strong>
                        </Toast.Header>
                        <Toast.Body style={{ fontSize: "13px", padding: "8px 12px" }}>
                            {toast.message}
                        </Toast.Body>
                    </Toast>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToastContext = (): ToastContextValue => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error("useToastContext must be used within ToastProvider");
    return ctx;
};
