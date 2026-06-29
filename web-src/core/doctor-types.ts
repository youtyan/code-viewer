export type DoctorStatus = "ok" | "warn" | "error";

export type DoctorRow = {
  id: string;
  title: string;
  status: DoctorStatus;
  detail?: string;
  hint?: string;
};

export type DoctorGroup = {
  id: string;
  title: string;
  rows: DoctorRow[];
};

export type DoctorReport = {
  generation: number;
  groups: DoctorGroup[];
  worstStatus: DoctorStatus;
};
