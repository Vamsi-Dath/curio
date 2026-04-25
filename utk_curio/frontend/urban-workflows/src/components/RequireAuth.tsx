import React from "react";
import { Navigate } from "react-router-dom";
import { useUserContext } from "../providers/UserProvider";
import { Loading } from "./login/Loading";

export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user, loading, enableUserAuth } = useUserContext();

  if (loading) return <Loading />;
  if (!user) {
    if (!enableUserAuth) return <Loading />;
    return <Navigate to="/auth/signin" replace />;
  }

  return <>{children}</>;
};
