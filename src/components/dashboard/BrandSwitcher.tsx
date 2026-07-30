"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Brand } from "@/types";

export function BrandSwitcher({
  brands,
  selectedBrandId,
  onSelect,
}: {
  brands: Brand[];
  selectedBrandId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Select value={selectedBrandId ?? undefined} onValueChange={(v) => v && onSelect(v)}>
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Pilih brand" />
      </SelectTrigger>
      <SelectContent>
        {brands.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
