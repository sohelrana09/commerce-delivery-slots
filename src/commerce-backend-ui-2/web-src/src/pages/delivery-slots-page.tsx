import { ActionButton } from "@react-spectrum/s2/ActionButton";
import { Content } from "@react-spectrum/s2/Content";
import { Heading } from "@react-spectrum/s2/Heading";
import { InlineAlert } from "@react-spectrum/s2/InlineAlert";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@react-spectrum/s2/SegmentedControl";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { Text } from "@react-spectrum/s2/Text";
import { useCallback, useEffect, useState } from "react";

import { BookingsView } from "../components/bookings-view.tsx";
import { ProfileEditor } from "../components/profile-editor.tsx";
import { ProfilesList } from "../components/profiles-list.tsx";
import { useSlotsApi } from "../hooks/use-slots-api.ts";
import { editableCopy, emptyProfile } from "../lib/profiles.ts";

import type { Lookups, Profile } from "../lib/types.ts";

type View = "profiles" | "bookings";
type Editing = { profile: Profile; originalCode?: string } | null;

export function DeliverySlotsPage() {
  const api = useSlotsApi();
  const [view, setView] = useState<View>("profiles");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [examples, setExamples] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listProfiles();
      setProfiles(data.profiles);
      setExamples(data.examples);
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
    api
      .lookups()
      .then(setLookups, () =>
        setLookups({ storeViews: [], unavailable: true }),
      );
  }, [api, load]);

  const handleEdit = useCallback(
    (code: string) => {
      const profile = profiles.find((p) => p.code === code);
      if (profile) {
        setEditing({ originalCode: code, profile: editableCopy(profile) });
      }
    },
    [profiles],
  );

  const handleCreate = useCallback((template?: Profile) => {
    setEditing({
      profile: template
        ? { ...editableCopy(template), enabled: false }
        : emptyProfile(),
    });
  }, []);

  const handleSave = async (profile: Profile, previousCode?: string) => {
    await api.saveProfile(profile, previousCode);
    setEditing(null);
    setNotice(
      `Saved “${profile.name}”. Shoppers see the change within a minute, once cached calendars expire.`,
    );
    await load();
  };

  const handleDelete = async (code: string) => {
    await api.deleteProfile(code);
    setEditing(null);
    setNotice("Profile deleted.");
    await load();
  };

  const page = style({
    display: "flex",
    flexDirection: "column",
    gap: 16,
    padding: 24,
  });

  if (editing) {
    return (
      <div className={page}>
        <ProfileEditor
          initial={editing.profile}
          key={editing.originalCode ?? "new"}
          lookups={lookups}
          onCancel={() => setEditing(null)}
          onDelete={handleDelete}
          onSave={handleSave}
          originalCode={editing.originalCode}
        />
      </div>
    );
  }

  return (
    <div className={page}>
      <SegmentedControl
        aria-label="View"
        onSelectionChange={(key) => setView(key as View)}
        selectedKey={view}>
        <SegmentedControlItem id="profiles">Profiles</SegmentedControlItem>
        <SegmentedControlItem id="bookings">Bookings</SegmentedControlItem>
      </SegmentedControl>

      {notice && (
        <InlineAlert variant="positive">
          <Heading>Done</Heading>
          <Content>
            <div
              className={style({
                alignItems: "center",
                display: "flex",
                gap: 8,
                justifyContent: "space-between",
              })}>
              <Text>{notice}</Text>
              <ActionButton isQuiet onPress={() => setNotice(null)}>
                Dismiss
              </ActionButton>
            </div>
          </Content>
        </InlineAlert>
      )}

      {view === "profiles" ? (
        <ProfilesList
          error={error}
          examples={examples}
          loading={loading}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onReload={load}
          profiles={profiles}
        />
      ) : (
        <BookingsView profiles={profiles} />
      )}
    </div>
  );
}
