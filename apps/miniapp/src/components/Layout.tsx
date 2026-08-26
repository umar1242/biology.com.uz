import { Outlet } from "react-router-dom";
import { TabBar } from "./TabBar";

export function Layout() {
  return (
    <div className="mx-auto min-h-screen max-w-md bg-app pb-28">
      <Outlet />
      <TabBar />
    </div>
  );
}
