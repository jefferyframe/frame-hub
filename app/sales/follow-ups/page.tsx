import { redirect } from "next/navigation";

/** Follow-ups moved into the CRM (tasks with owners, times and calendar reminders). */
export default function FollowUps() {
  redirect("/crm");
}
