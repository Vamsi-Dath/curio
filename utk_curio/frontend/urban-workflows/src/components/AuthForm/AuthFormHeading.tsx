import React from "react";
import CSS from "csstype";

interface Props {
  title: string;
  subtitle?: string;
}

export const AuthFormHeading: React.FC<Props> = ({ title, subtitle }) => {
  return (
    <div style={containerStyle}>
      <h2 style={titleStyle}>{title}</h2>
      {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
    </div>
  );
};

const containerStyle: CSS.Properties = {
  marginBottom: "24px",
};

const titleStyle: CSS.Properties = {
  fontSize: "24px",
  fontWeight: 600,
  color: "#1E1F23",
  margin: "0 0 8px 0",
};

const subtitleStyle: CSS.Properties = {
  fontSize: "14px",
  color: "#6B6B76",
  margin: 0,
};
