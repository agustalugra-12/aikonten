"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { Project } from "@/types";
import { STATUS_LABEL, STATUS_VARIANT } from "@/types";

export function ProjectList({ projects }: { projects: Project[] }) {
  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Belum ada konten utk brand ini.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tipe</TableHead>
          <TableHead>Skrip</TableHead>
          <TableHead>Caption</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Dibuat</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="capitalize">{p.type}</TableCell>
            <TableCell className="max-w-[200px] truncate">{p.script}</TableCell>
            <TableCell className="max-w-[280px] truncate">{p.generatedCaption || "-"}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[p.status]}>{STATUS_LABEL[p.status]}</Badge>
              {p.status === "failed" && p.errorMessage && (
                <p className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={p.errorMessage}>
                  {p.errorMessage}
                </p>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {new Date(p.createdAt).toLocaleString("id-ID")}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
