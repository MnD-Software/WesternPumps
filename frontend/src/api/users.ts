import { api } from "./client";
import type { TechnicianZone, TechnicianZoneAdminRow, User, UserPreferences, UserRole } from "./types";

export type CreateUserPayload = {
  email: string;
  phone?: string | null;
  password: string;
  full_name?: string | null;
  role?: UserRole;
  must_change_password?: boolean;
};

export async function readMe(): Promise<User> {
  return (await api.get<User>("/users/me")).data;
}

export async function listUsers(): Promise<User[]> {
  return (await api.get<User[]>("/users")).data;
}

export async function listAssignableUsers(): Promise<User[]> {
  return (await api.get<User[]>("/users/assignable")).data;
}

export async function createUser(payload: CreateUserPayload): Promise<User> {
  return (await api.post<User>("/users", payload)).data;
}

export async function updateUser(
  userId: number,
  payload: { phone?: string | null; full_name?: string | null; role?: UserRole; is_active?: boolean; must_change_password?: boolean }
): Promise<User> {
  return (await api.patch<User>(`/users/${userId}`, payload)).data;
}

export async function deactivateUser(userId: number): Promise<void> {
  await api.delete(`/users/${userId}`);
}

export async function reactivateUser(userId: number): Promise<void> {
  await api.post(`/users/${userId}/reactivate`);
}

export async function hardDeleteUser(userId: number): Promise<void> {
  await api.delete(`/users/${userId}/hard`);
}

export async function changeMyPassword(payload: { current_password: string; new_password: string }): Promise<void> {
  await api.post("/users/me/password", payload);
}

export async function adminResetUserPassword(userId: number, newPassword: string): Promise<void> {
  await api.post(`/users/${userId}/password`, { new_password: newPassword, must_change_password: true });
}

export async function adminResetPasswordByRole(payload: {
  role: UserRole;
  new_password: string;
  must_change_password?: boolean;
  active_only?: boolean;
}): Promise<{ role: string; users_updated: number }> {
  return (await api.post<{ role: string; users_updated: number }>("/users/password/by-role", payload)).data;
}

export async function listUserZones(userId: number): Promise<TechnicianZone[]> {
  return (await api.get<TechnicianZone[]>(`/users/${userId}/zones`)).data;
}

export async function listAllTechnicianZones(includeInactive = false): Promise<TechnicianZoneAdminRow[]> {
  return (await api.get<TechnicianZoneAdminRow[]>("/users/technician-zones", { params: includeInactive ? { include_inactive: true } : undefined })).data;
}

export async function createUserZone(
  userId: number,
  payload: { region_label: string; station_name: string; client_code?: string | null; zone_order: number }
): Promise<TechnicianZone> {
  return (await api.post<TechnicianZone>(`/users/${userId}/zones`, payload)).data;
}

export async function updateUserZone(
  userId: number,
  zoneId: number,
  payload: Partial<{ region_label: string; station_name: string; client_code: string | null; zone_order: number }>
): Promise<TechnicianZone> {
  return (await api.patch<TechnicianZone>(`/users/${userId}/zones/${zoneId}`, payload)).data;
}

export async function deleteUserZone(userId: number, zoneId: number): Promise<void> {
  await api.delete(`/users/${userId}/zones/${zoneId}`);
}

export async function listMyZones(): Promise<TechnicianZone[]> {
  return (await api.get<TechnicianZone[]>("/users/me/zones")).data;
}

export async function getMyPreferences(): Promise<UserPreferences> {
  return (await api.get<UserPreferences>("/users/me/preferences")).data;
}

export async function updateMyPreferences(
  payload: Partial<UserPreferences>
): Promise<UserPreferences> {
  return (await api.put<UserPreferences>("/users/me/preferences", payload)).data;
}

export type TechnicianImportSummary = {
  created_users: number;
  updated_users: number;
  created_zones: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export async function importTechniciansZonesXlsx(file: File, dryRun = false): Promise<TechnicianImportSummary> {
  const form = new FormData();
  form.append("file", file);
  return (
    await api.post<TechnicianImportSummary>("/api/import/technicians-zones-xlsx", form, {
      params: dryRun ? { dry_run: true } : undefined,
      headers: { "Content-Type": "multipart/form-data" }
    })
  ).data;
}
