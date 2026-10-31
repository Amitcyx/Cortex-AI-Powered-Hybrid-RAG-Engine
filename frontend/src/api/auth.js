import { v4 as uuidv4 } from "uuid";

const AUTH_STORAGE_KEY = "cortex_auth_user";
const USERS_DB_KEY = "cortex_registered_users";

const DEFAULT_USER = {
  id: "user_default",
  name: "Amit Pol",
  email: "amit@cortex.ai",
  avatarColor: "linear-gradient(135deg, #4285f4, #9b51e0)",
};

function getRegisteredUsers() {
  try {
    const raw = localStorage.getItem(USERS_DB_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [DEFAULT_USER];
}

function saveRegisteredUsers(users) {
  try {
    localStorage.setItem(USERS_DB_KEY, JSON.stringify(users));
  } catch {}
}

export async function loginUser(email, password) {
  // Simulate auth latency
  await new Promise((r) => setTimeout(r, 300));

  const users = getRegisteredUsers();
  const normalizedEmail = email.trim().toLowerCase();
  let user = users.find((u) => u.email.toLowerCase() === normalizedEmail);

  if (!user) {
    // Auto-create on first login if not registered
    user = {
      id: `user_${uuidv4().slice(0, 8)}`,
      name: email.split("@")[0] || "User",
      email: normalizedEmail,
      avatarColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
    };
    users.push(user);
    saveRegisteredUsers(users);
  }

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  return user;
}

export async function registerUser(name, email, password) {
  await new Promise((r) => setTimeout(r, 300));
  const users = getRegisteredUsers();
  const normalizedEmail = email.trim().toLowerCase();

  let user = users.find((u) => u.email.toLowerCase() === normalizedEmail);
  if (user) {
    user.name = name.trim();
  } else {
    user = {
      id: `user_${uuidv4().slice(0, 8)}`,
      name: name.trim() || email.split("@")[0] || "User",
      email: normalizedEmail,
      avatarColor: `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`,
    };
    users.push(user);
  }
  saveRegisteredUsers(users);
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  return user;
}

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return DEFAULT_USER;
}

export function logoutUser() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}
}
