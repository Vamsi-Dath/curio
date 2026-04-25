import React, { ReactNode } from "react";
import CSS from "csstype";
import curioLogoWhite from "assets/curio_logo_white.png";

interface Props {
  children: ReactNode;
}

export const AuthFormWrapper: React.FC<Props> = ({ children }) => {
  return (
    <div style={outerStyle}>
      <div style={leftPanelStyle}>
        <a href="https://urbantk.org/curio" target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center" }}>
          <img
            src={curioLogoWhite}
            alt="Curio"
            style={logoStyle}
          />
        </a>
        <div style={taglineGroupStyle}>
          <p style={taglineStyle}>Visual dataflows for urban data</p>
          <a href="https://urbantk.org/curio" target="_blank" rel="noreferrer" style={urlStyle}>
            urbantk.org/curio
          </a>
        </div>
      </div>
      <div style={rightPanelStyle}>{children}</div>
    </div>
  );
};

const outerStyle: CSS.Properties = {
  display: "flex",
  minHeight: "100vh",
  fontFamily:
    "Rubik, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif",
};

const leftPanelStyle: CSS.Properties = {
  width: "42%",
  backgroundColor: "#1E1F23",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "28px",
  padding: "40px",
};

const logoStyle: CSS.Properties = {
  width: "60%",
  maxWidth: "340px",
  height: "auto",
};

const taglineGroupStyle: CSS.Properties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "8px",
};

const taglineStyle: CSS.Properties = {
  color: "#D8D8D8",
  fontSize: "17px",
  fontWeight: 400,
  letterSpacing: "1px",
  margin: 0,
  textAlign: "center",
};

const urlStyle: CSS.Properties = {
  color: "#888",
  fontSize: "13px",
  textDecoration: "none",
  letterSpacing: "0.5px",
};

const rightPanelStyle: CSS.Properties = {
  width: "58%",
  backgroundColor: "#f0f0f0",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "40px",
};
