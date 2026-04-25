import React from "react";
import CSS from "csstype";
import { GoogleOAuthProvider, useGoogleLogin } from "@react-oauth/google";
import { useUserContext } from "../../providers/UserProvider";

interface Props {
  googleClientId: string;
  onGoogleSuccess: (code: string) => void;
  showGuest: boolean;
  onGuest: () => void;
}

const GoogleBtn: React.FC<{ onSuccess: (code: string) => void }> = ({
  onSuccess,
}) => {
  const login = useGoogleLogin({
    onSuccess: (resp) => onSuccess(resp.code),
    flow: "auth-code",
  });

  return (
    <button type="button" style={googleBtnStyle} onClick={login}>
      Sign in with Google
    </button>
  );
};

export const AltAuthBox: React.FC<Props> = ({
  googleClientId,
  onGoogleSuccess,
  showGuest,
  onGuest,
}) => {
  return (
    <div style={containerStyle}>
      <div style={dividerStyle}>
        <span style={dividerLineStyle} />
        <span style={dividerTextStyle}>or</span>
        <span style={dividerLineStyle} />
      </div>

      {googleClientId && (
        <GoogleOAuthProvider clientId={googleClientId}>
          <GoogleBtn onSuccess={onGoogleSuccess} />
        </GoogleOAuthProvider>
      )}

      {showGuest && (
        <button type="button" style={guestBtnStyle} onClick={onGuest}>
          Continue as Guest
        </button>
      )}
    </div>
  );
};

const containerStyle: CSS.Properties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
  marginTop: "16px",
};

const dividerStyle: CSS.Properties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const dividerLineStyle: CSS.Properties = {
  flex: 1,
  height: "1px",
  backgroundColor: "#E0E0E0",
};

const dividerTextStyle: CSS.Properties = {
  fontSize: "13px",
  color: "#9E9E9E",
};

const googleBtnStyle: CSS.Properties = {
  width: "100%",
  padding: "10px",
  border: "1px solid #E0E0E0",
  borderRadius: "6px",
  backgroundColor: "#fff",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
  color: "#0F0F11",
};

const guestBtnStyle: CSS.Properties = {
  width: "100%",
  padding: "10px",
  border: "1px solid #E0E0E0",
  borderRadius: "6px",
  backgroundColor: "#fff",
  fontSize: "14px",
  fontWeight: 500,
  cursor: "pointer",
  color: "#0F0F11",
};
