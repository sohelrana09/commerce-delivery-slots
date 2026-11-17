import { createExtensionApp } from "@adobe/aio-commerce-lib-admin-ui/web";
import "@react-spectrum/s2/page.css";

import config from "#app.commerce.config";

import { SlotsApiContext, useActionsApi } from "./hooks/use-slots-api.ts";
import { DeliverySlotsPage } from "./pages/delivery-slots-page.tsx";

function AdminPage() {
  const api = useActionsApi();
  return (
    <SlotsApiContext value={api}>
      <DeliverySlotsPage />
    </SlotsApiContext>
  );
}

createExtensionApp({
  menu: <AdminPage />,
  metadata: {
    extensionId: config.metadata.id,
  },
});
