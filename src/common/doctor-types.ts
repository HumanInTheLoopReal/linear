export type CheckStatus = "ok" | "warning" | "error";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
  fix?: string;
  category: string;
  observed_state?: string;
  expected_state?: string;
  explanation?: string;
  commands?: string[];
  severity?: "info" | "warning" | "error";
}
