import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_authenticated/admin/")({
  loader: async () => {
    throw redirect({ to: "/admin/ironclaw" });
  },
});
