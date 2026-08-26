import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { ThemeProvider } from "./lib/theme";
import { I18nProvider } from "./lib/i18n";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401/403/404 is a verdict, not a hiccup — the default 3 retries with
      // backoff just delayed the error state by seconds and, for 401, fired
      // three more doomed requests before the session-expiry redirect.
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status >= 400 && error.status < 500
          ? false
          : failureCount < 3,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <I18nProvider>
              <App />
            </I18nProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
