"use client";

import { useMemo, type ComponentProps } from "react";
import { timezoneGroups } from "@/lib/timezones";
import { Select } from "./field";

/** A select of every IANA timezone, grouped by region, with the UTC offset in each label. */
export function TimezoneSelect({
  value,
  ...props
}: Omit<ComponentProps<typeof Select>, "children"> & { value: string }) {
  const groups = useMemo(() => timezoneGroups(value), [value]);
  return (
    <Select value={value} {...props}>
      {groups.map((group) => (
        <optgroup key={group.region} label={group.region}>
          {group.zones.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
