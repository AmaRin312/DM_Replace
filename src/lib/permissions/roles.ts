import type { AdminRole } from "@/types/profile";

export function canAccessAdmin(role: AdminRole): boolean {
  return ["owner", "admin", "editor", "support"].includes(role);
}

export function canEditCards(role: AdminRole): boolean {
  return ["owner", "admin", "editor"].includes(role);
}

export function canEditSupplies(role: AdminRole): boolean {
  return ["owner", "admin", "editor"].includes(role);
}

export function canEditAnnouncements(role: AdminRole): boolean {
  return ["owner", "admin"].includes(role);
}

export function canViewRooms(role: AdminRole): boolean {
  return ["owner", "admin", "support"].includes(role);
}

export function canViewHighLoadAlerts(role: AdminRole): boolean {
  return ["owner", "admin", "support"].includes(role);
}
