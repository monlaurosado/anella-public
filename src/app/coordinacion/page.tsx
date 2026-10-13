import { redirect } from "next/navigation";

export default function CoordinationPage() {
  redirect("/coordinacion/incidentes?view=active");
}
