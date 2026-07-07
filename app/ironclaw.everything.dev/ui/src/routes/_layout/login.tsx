import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { sessionQueryOptions, useAuthClient } from "@/app";
import ironclawLogo from "@/assets/ironclaw-attack.png";

type SearchParams = {
  redirect?: string;
};

export const Route = createFileRoute("/_layout/login")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    const { queryClient, authClient } = context;
    const initialSession = context.session;
    const session =
      initialSession ??
      queryClient.getQueryData(sessionQueryOptions(authClient, initialSession).queryKey);

  const handleGoogle = async () => {
    setGooglePending(true);
    try {
      const callbackURL =
        typeof window !== "undefined" ? `${window.location.origin}${redirectTo}` : redirectTo;
      await auth.signIn.social({
        provider: "google",
        callbackURL,
      });
    } catch (err) {
      setGooglePending(false);
      handleError(err instanceof Error ? err : new Error("Google sign-in failed"));
    }
  };

  if (session?.user) {
      const redirectTo = search.redirect?.startsWith("/") ? search.redirect : "/chat";
      throw redirect({ to: redirectTo, search: {} });
    }
  },
  loader: ({ context }) => {
    const initialSession = context.session;
    void context.queryClient.prefetchQuery(sessionQueryOptions(context.authClient, initialSession));
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuthClient();
  const { data: session } = useQuery(sessionQueryOptions(auth, undefined));
  const { redirect } = Route.useSearch();
  const queryClient = useQueryClient();

  const [nearPending, setNearPending] = useState(false);
  const [githubPending, setGithubPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  const redirectTo = redirect?.startsWith("/") ? redirect : "/chat";

  const handleSuccess = async (message: string) => {
    toast.success(message);
    const { data: freshSession } = await auth.getSession();
    if (freshSession) {
      queryClient.setQueryData(["session"], freshSession);
    }
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    navigate({ to: redirectTo, replace: true, search: {} });
  };

  const handleError = (error: { code?: string; message?: string } | Error) => {
    const code = "code" in error ? error.code : undefined;
    const message = "message" in error ? error.message : "Failed to sign in";
    if (code === "UNAUTHORIZED_NONCE_REPLAY") toast.error("Sign-in already used");
    else if (code === "UNAUTHORIZED_INVALID_SIGNATURE") toast.error("Invalid signature");
    else if (code === "SIGNER_NOT_AVAILABLE") toast.error("NEAR wallet not available");
    else toast.error(message || "Failed to sign in");
  };

  const handleNear = async () => {
    setNearPending(true);
    await auth.signIn.near({
      onSuccess: async () => {
        setNearPending(false);
        await handleSuccess("Signed in with NEAR");
      },
      onError: (error: { code?: string; message?: string }) => {
        setNearPending(false);
        handleError(error);
      },
    });
  };

  const handleGithub = async () => {
    setGithubPending(true);
    try {
      const callbackURL =
        typeof window !== "undefined" ? `${window.location.origin}${redirectTo}` : redirectTo;
      await auth.signIn.social({
        provider: "github",
        callbackURL,
      });
    } catch (err) {
      setGithubPending(false);
      handleError(err instanceof Error ? err : new Error("GitHub sign-in failed"));
    }
  };

  if (session?.user) {
    return <Navigate to={redirectTo} replace search={{}} />;
  }

  const isPending = nearPending || githubPending || googlePending;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 sm:py-16 animate-fade-in">
        <div className="w-full max-w-md space-y-8 sm:space-y-10">
          <div className="flex flex-col items-center text-center space-y-4">
            <img
              src={ironclawLogo}
              alt="IronClaw"
              className="h-20 w-20 sm:h-24 sm:w-24 object-contain drop-shadow-sm"
            />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              Sign in to IronClaw
            </h1>
          </div>

          <div className="space-y-3 animate-fade-in-up">
            <button
              type="button"
              onClick={handleNear}
              disabled={isPending}
              className="group flex w-full items-center justify-center gap-2.5 rounded-2xl bg-foreground px-6 py-4 text-base font-semibold text-background shadow-sm transition-all duration-200 hover:bg-foreground/90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 touch-manipulation min-h-14"
            >
              <span
                className="inline-block h-2 w-2 rounded-full bg-[color:var(--near-green)] shadow-[0_0_8px_var(--near-green)]"
                aria-hidden="true"
              />
              <span>{nearPending ? "Connecting..." : "Connect with NEAR"}</span>
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <button
              type="button"
              onClick={handleGithub}
              disabled={isPending}
              className="group flex w-full items-center gap-3 rounded-2xl border-2 border-border bg-card px-5 py-4 text-left transition-all duration-200 hover:border-foreground/40 hover:bg-muted/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 touch-manipulation min-h-14"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                <GithubGlyph />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {githubPending ? "Redirecting..." : "Continue with GitHub"}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={handleGoogle}
              disabled={isPending}
              className="group flex w-full items-center gap-3 rounded-2xl border-2 border-border bg-card px-5 py-4 text-left transition-all duration-200 hover:border-foreground/40 hover:bg-muted/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 touch-manipulation min-h-14"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted">
                <GoogleGlyph />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {googlePending ? "Redirecting..." : "Continue with Google"}
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GithubGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className="fill-foreground"
    >
      <title>GitHub</title>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.16-.02-2.11-3.19.69-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.39-5.25 5.67.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.13 0 .3.21.67.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <title>Google</title>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44c-.28 1.48-1.13 2.73-2.4 3.58v2.98h3.87c2.26-2.09 3.58-5.17 3.58-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.93l-3.87-2.98c-1.07.72-2.44 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.96H1.29v3.11C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28A7.24 7.24 0 0 1 4.87 12c0-.79.14-1.56.4-2.28V6.61H1.29A11.997 11.997 0 0 0 0 12c0 1.94.47 3.77 1.29 5.39l3.99-3.11z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.61l3.99 3.11C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}
