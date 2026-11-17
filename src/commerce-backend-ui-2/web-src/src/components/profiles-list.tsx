import { ActionButton } from "@react-spectrum/s2/ActionButton";
import { Button } from "@react-spectrum/s2/Button";
import { Content } from "@react-spectrum/s2/Content";
import { Heading } from "@react-spectrum/s2/Heading";
import { IllustratedMessage } from "@react-spectrum/s2/IllustratedMessage";
import { InlineAlert } from "@react-spectrum/s2/InlineAlert";
import Refresh from "@react-spectrum/s2/icons/Refresh";
import { Menu, MenuItem, MenuTrigger } from "@react-spectrum/s2/Menu";
import { ProgressCircle } from "@react-spectrum/s2/ProgressCircle";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import {
  Cell,
  Column,
  Row,
  TableBody,
  TableHeader,
  TableView,
} from "@react-spectrum/s2/TableView";
import { useCallback } from "react";

import {
  describeCutoffs,
  describeDays,
  describeMethods,
} from "../lib/profiles.ts";

import type { Key } from "react-aria-components";
import type { Profile } from "../lib/types.ts";

export type ProfilesListProps = {
  error: string | null;
  examples: Profile[];
  loading: boolean;
  onCreate: (template?: Profile) => void;
  onEdit: (code: string) => void;
  onReload: () => void;
  profiles: Profile[];
};

export function ProfilesList({
  profiles,
  examples,
  loading,
  error,
  onReload,
  onEdit,
  onCreate,
}: ProfilesListProps) {
  const handleRowAction = useCallback(
    (key: Key) => onEdit(String(key)),
    [onEdit],
  );
  const handleNew = useCallback(() => onCreate(), [onCreate]);
  const handleTemplate = useCallback(
    (key: Key) => {
      const example = examples.find((profile) => profile.code === key);
      if (example) {
        onCreate(example);
      }
    },
    [examples, onCreate],
  );

  const renderEmptyState = useCallback(
    () => (
      <IllustratedMessage>
        <Heading>No delivery profiles yet</Heading>
        <Content>
          Add a delivery or pickup calendar, or start from an example.
        </Content>
      </IllustratedMessage>
    ),
    [],
  );

  return (
    <main
      className={style({ display: "flex", flexDirection: "column", gap: 16 })}>
      <div
        className={style({
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        })}>
        <Heading
          level={1}
          styles={style({ flexGrow: 1, font: "heading-lg", margin: 0 })}>
          Delivery profiles
        </Heading>
        <ActionButton
          aria-label="Reload"
          isDisabled={loading}
          onPress={onReload}>
          <Refresh />
        </ActionButton>
        <MenuTrigger>
          <Button variant="secondary">Start from example</Button>
          <Menu items={examples} onAction={handleTemplate}>
            {(example) => <MenuItem id={example.code}>{example.name}</MenuItem>}
          </Menu>
        </MenuTrigger>
        <Button onPress={handleNew} variant="accent">
          Add profile
        </Button>
      </div>

      {error && (
        <InlineAlert variant="negative">
          <Heading>Couldn't load profiles</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}

      {loading ? (
        <div
          className={style({
            display: "flex",
            justifyContent: "center",
            marginTop: 32,
          })}>
          <ProgressCircle
            aria-label="Loading profiles"
            isIndeterminate
            size="L"
          />
        </div>
      ) : (
        <TableView
          aria-label="Delivery profiles"
          onAction={handleRowAction}
          selectionMode="none"
          styles={style({ minHeight: 320, width: "full" })}>
          <TableHeader>
            <Column isRowHeader>Name</Column>
            <Column>Type</Column>
            <Column>Shipping methods</Column>
            <Column>Days</Column>
            <Column>Cut-offs</Column>
            <Column>Slots</Column>
            <Column>Priority</Column>
            <Column>Status</Column>
          </TableHeader>
          <TableBody items={profiles} renderEmptyState={renderEmptyState}>
            {(profile) => (
              <Row id={profile.code}>
                <Cell>{profile.name}</Cell>
                <Cell>{profile.type === "pickup" ? "Pickup" : "Delivery"}</Cell>
                <Cell>{describeMethods(profile)}</Cell>
                <Cell>{describeDays(profile.workingDays)}</Cell>
                <Cell>{describeCutoffs(profile)}</Cell>
                <Cell>{String(profile.slots?.length ?? 0)}</Cell>
                <Cell>{String(profile.priority ?? 0)}</Cell>
                <Cell>
                  <StatusLight
                    size="S"
                    variant={
                      profile.enabled === false ? "neutral" : "positive"
                    }>
                    {profile.enabled === false ? "Off" : "On"}
                  </StatusLight>
                </Cell>
              </Row>
            )}
          </TableBody>
        </TableView>
      )}
    </main>
  );
}
