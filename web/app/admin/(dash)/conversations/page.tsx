"use client";

import { LoadState, PageHeader } from "@/components/admin";
import type { Conversation } from "@/lib/types";
import { useAdminData } from "@/lib/useAdmin";
import { ConversationTable } from "./table";

export default function ConversationsPage() {
  const { data, error, loading, reload } = useAdminData<Conversation[]>("conversations?limit=500");
  return (
    <>
      <PageHeader title="Conversations" description="All calls with Jane, newest first. Select a row for the full transcript." onRefresh={reload} />
      <div className="card">
        <LoadState loading={loading && !data} error={error} empty={data?.length === 0} />
        {data?.length ? <ConversationTable rows={data} /> : null}
      </div>
    </>
  );
}
