import { useState, useCallback, useEffect } from "react";
import { getCurrentUser, loginUser, registerUser, logoutUser } from "../api/auth";

export function useAuth() {
  const [currentUser, setCurrentUser] = useState(getCurrentUser);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  useEffect(() => {
    const user = getCurrentUser();
    setCurrentUser(user);
  }, []);

  const login = useCallback(async (email, password) => {
    const user = await loginUser(email, password);
    setCurrentUser(user);
    setIsAuthModalOpen(false);
    return user;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const user = await registerUser(name, email, password);
    setCurrentUser(user);
    setIsAuthModalOpen(false);
    return user;
  }, []);

  const logout = useCallback(() => {
    logoutUser();
    const defaultUser = getCurrentUser();
    setCurrentUser(defaultUser);
  }, []);

  return {
    currentUser,
    isAuthModalOpen,
    openAuthModal: () => setIsAuthModalOpen(true),
    closeAuthModal: () => setIsAuthModalOpen(false),
    login,
    register,
    logout,
  };
}
