// manage-collaboration/index.ts
// Supabase Edge Function: Collaborator Groups & Secure Deal Sharing
// Provides server-side Group management (create, rename, update members)
// and deal sharing with individual collaborators or entire groups.

import { serve } from "std/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { buildShareEmail, pickRecipients, sendShareEmails } from "../_shared/shareNotification.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

function getEnv(key: string): string {
  try {
    return Deno.env.get(key) || "";
  } catch {
    return "";
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Emails newly added recipients that a property was shared with them. Best effort: any failure is logged and never reaches the caller.
async function notifyNewShare(
  dbClient: any,
  opts: { dealId: string; ownerId: string; ownerEmail: string | null; recipients: Array<string | null | undefined>; permission: "viewer" | "editor"; groupName?: string | null },
): Promise<void> {
  try {
    const apiKey = getEnv("RESEND_API_KEY");
    if (!apiKey) return;
    const to = pickRecipients(opts.recipients, opts.ownerEmail);
    if (to.length === 0) return;
    const { data: deal } = await dbClient.from("deals").select("title").eq("id", opts.dealId).maybeSingle();
    const { data: owner } = await dbClient.from("profiles").select("full_name").eq("id", opts.ownerId).maybeSingle();
    const { subject, html } = buildShareEmail({
      dealTitle: deal?.title || "",
      sharerName: owner?.full_name || opts.ownerEmail || "A MathTree user",
      permission: opts.permission,
      appUrl: getEnv("APP_URL") || "https://mathtree-app.web.app",
      groupName: opts.groupName,
    });
    const from = getEnv("RESEND_FROM_EMAIL") || "MathTree <onboarding@resend.dev>";
    await sendShareEmails(apiKey, from, to, { subject, html });
  } catch (e) {
    console.warn("[manage-collaboration] share notification failed:", e);
  }
}

// The service-role client bypasses RLS, so every deal-scoped action must check ownership itself.
async function ownsDeal(dbClient: any, dealId: string, userId: string): Promise<boolean> {
  const { data } = await dbClient.from("deals").select("id").eq("id", dealId).eq("user_id", userId).maybeSingle();
  return !!data;
}

function cleanEmails(list: unknown[]): string[] {
  const out = new Set<string>();
  for (const e of list) {
    const v = typeof e === "string" ? e.trim().toLowerCase() : "";
    if (v && v.includes("@")) out.add(v);
  }
  return Array.from(out);
}

// Updates the existing share row when there is one, else inserts. A plain upsert with no conflict target always inserts, which
// piles up duplicates for email shares and fails the (deal_id, shared_with_user_id) constraint when a registered user is re-shared.
async function saveShare(dbClient: any, existingId: string | null | undefined, row: Record<string, unknown>) {
  if (existingId) {
    return await dbClient.from("deal_shares").update({ ...row, updated_at: new Date().toISOString() }).eq("id", existingId).select().single();
  }
  return await dbClient.from("deal_shares").insert(row).select().single();
}

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const supabaseAnonKey = getEnv("SUPABASE_ANON_KEY");
  const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY") || supabaseAnonKey;
  const authHeader = req.headers.get("Authorization");

  let userId: string | null = null;
  let userEmail: string | null = null;

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Supabase configuration missing" }, 500);
  }

  const dbClient = createClient(supabaseUrl, supabaseServiceKey);

  if (authHeader && supabaseAnonKey) {
    try {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await authClient.auth.getUser();
      if (!error && data?.user) {
        userId = data.user.id;
        userEmail = data.user.email || null;
      }
    } catch (e) {
      console.warn("[manage-collaboration] Auth token check error:", e);
    }
  }

  let body: Record<string, unknown> = {};
  if (req.method !== "GET") {
    try {
      body = await req.json();
    } catch {
      body = {};
    }
  }

  const url = new URL(req.url);
  const action = (body.action as string) || url.searchParams.get("action") || "list_hub";

  // Simulated Demo Fallback if unauthenticated / demo user
  if (!userId) {
    return handleDemoCollaboration(action, body, url);
  }

  try {
    switch (action) {
      // 1. LIST COLLABORATORS & GROUPS HUB
      case "list_hub": {
        // Fetch user's custom collaborator groups with members
        const { data: groups, error: grpErr } = await dbClient
          .from("collaborator_groups")
          .select("id, name, description, created_at, updated_at, collaborator_group_members(id, member_email, member_user_id, created_at)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (grpErr) throw grpErr;

        // Fetch all direct deals shared by this user
        const { data: shares, error: shareErr } = await dbClient
          .from("deal_shares")
          .select("id, deal_id, group_id, shared_with_user_id, shared_with_email, permission, can_view_scenarios, created_at, deals(title, id)")
          .eq("owner_id", userId);

        if (shareErr) throw shareErr;

        // Collect distinct collaborator emails
        const emailSet = new Set<string>();
        (groups || []).forEach((g: any) => {
          (g.collaborator_group_members || []).forEach((m: any) => {
            if (m.member_email) emailSet.add(m.member_email.toLowerCase());
          });
        });
        (shares || []).forEach((s: any) => {
          if (s.shared_with_email) emailSet.add(s.shared_with_email.toLowerCase());
        });

        const directCollaborators = Array.from(emailSet).map((email) => ({
          email,
          deals_count: (shares || []).filter((s: any) => (s.shared_with_email || "").toLowerCase() === email).length,
        }));

        return jsonResponse({
          success: true,
          groups: groups || [],
          direct_collaborators: directCollaborators,
          shares_count: (shares || []).length,
        });
      }

      // 2. CREATE COLLABORATOR GROUP
      case "create_group": {
        const name = (body.name as string)?.trim();
        const description = (body.description as string)?.trim() || null;
        const members = (body.members as string[]) || [];

        if (!name) return jsonResponse({ error: "Group name is required" }, 400);

        const { data: newGroup, error: grpError } = await dbClient
          .from("collaborator_groups")
          .insert({
            user_id: userId,
            name,
            description,
          })
          .select()
          .single();

        if (grpError) throw grpError;

        const rows = cleanEmails(members).map((email) => ({ group_id: newGroup.id, member_email: email }));
        if (rows.length > 0) {
          const { error: memErr } = await dbClient.from("collaborator_group_members").insert(rows);
          if (memErr) {
            // Do not leave a half-built group behind.
            await dbClient.from("collaborator_groups").delete().eq("id", newGroup.id).eq("user_id", userId);
            throw memErr;
          }
        }

        return jsonResponse({ success: true, group: newGroup, message: "Group created successfully" });
      }

      // 3. UPDATE / RENAME GROUP & SYNC MEMBERS
      case "update_group": {
        const groupId = (body.group_id as string) || (body.groupId as string);
        const name = (body.name as string)?.trim();
        const description = (body.description as string)?.trim();
        const members = body.members as string[] | undefined;

        if (!groupId || !name) return jsonResponse({ error: "Group ID and name are required" }, 400);

        const { data: updatedGroup, error: updErr } = await dbClient
          .from("collaborator_groups")
          .update({
            name,
            description: description !== undefined ? description : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", groupId)
          .eq("user_id", userId)
          .select()
          .single();

        if (updErr) throw updErr;

        if (Array.isArray(members)) {
          // Add the new members first and only then drop the ones that were removed, so a failed insert never empties the group.
          const emails = cleanEmails(members);
          if (emails.length > 0) {
            const { error: addErr } = await dbClient
              .from("collaborator_group_members")
              .upsert(emails.map((email) => ({ group_id: groupId, member_email: email })), { onConflict: "group_id,member_email" });
            if (addErr) throw addErr;
          }
          const { data: current, error: curErr } = await dbClient
            .from("collaborator_group_members")
            .select("id, member_email")
            .eq("group_id", groupId);
          if (curErr) throw curErr;
          const keep = new Set(emails);
          const dropIds = (current || []).filter((m: any) => !keep.has(String(m.member_email || "").toLowerCase())).map((m: any) => m.id);
          if (dropIds.length > 0) {
            const { error: delErr } = await dbClient.from("collaborator_group_members").delete().in("id", dropIds);
            if (delErr) throw delErr;
          }
        }

        return jsonResponse({ success: true, group: updatedGroup, message: "Group updated" });
      }

      // 4. DELETE COLLABORATOR GROUP
      case "delete_group": {
        const groupId = (body.group_id as string) || (body.groupId as string) || url.searchParams.get("group_id");
        if (!groupId) return jsonResponse({ error: "Group ID is required" }, 400);

        const { error: delErr } = await dbClient
          .from("collaborator_groups")
          .delete()
          .eq("id", groupId)
          .eq("user_id", userId);

        if (delErr) throw delErr;
        return jsonResponse({ success: true, message: "Group deleted" });
      }

      // 5. SHARE DEAL (WITH GROUP OR DIRECT EMAIL)
      case "share_deal": {
        const dealId = (body.deal_id as string) || (body.dealId as string);
        const shareType = (body.share_type as string) || (body.shareType as string) || "email"; // 'group' | 'email'
        const targetId = (body.target_id as string) || (body.targetId as string); // groupId or email
        const permission = (body.permission as string) === "editor" ? "editor" : "viewer";
        const canViewScenarios = body.can_view_scenarios !== false;

        if (!dealId || !targetId) {
          return jsonResponse({ error: "Deal ID and target (group or email) are required" }, 400);
        }
        if (!(await ownsDeal(dbClient, dealId, userId))) {
          return jsonResponse({ error: "Only the owner can share this property" }, 403);
        }

        if (shareType === "group") {
          // Verify group ownership
          const { data: grp } = await dbClient
            .from("collaborator_groups")
            .select("id, name")
            .eq("id", targetId)
            .eq("user_id", userId)
            .maybeSingle();

          if (!grp) return jsonResponse({ error: "Collaborator group not found" }, 404);

          const { data: priorGroupShare } = await dbClient
            .from("deal_shares")
            .select("id")
            .eq("deal_id", dealId)
            .eq("group_id", targetId)
            .maybeSingle();

          // Insert or update group deal share
          const { data: shareRow, error: sErr } = await saveShare(dbClient, priorGroupShare?.id, {
            deal_id: dealId,
            owner_id: userId,
            group_id: targetId,
            shared_with_email: null,
            permission,
            can_view_scenarios: canViewScenarios,
          });

          if (sErr) throw sErr;
          if (!priorGroupShare) {
            const { data: members } = await dbClient
              .from("collaborator_group_members")
              .select("member_email")
              .eq("group_id", targetId);
            await notifyNewShare(dbClient, {
              dealId, ownerId: userId, ownerEmail: userEmail, permission,
              recipients: (members || []).map((m: any) => m.member_email), groupName: grp.name,
            });
          }
          return jsonResponse({ success: true, share: shareRow, message: `Deal shared with group "${grp.name}"` });
        } else {
          // Direct email share
          const cleanEmail = targetId.trim().toLowerCase();
          if (!cleanEmail.includes("@")) return jsonResponse({ error: "Valid email required" }, 400);
          if (cleanEmail === (userEmail || "").trim().toLowerCase()) {
            return jsonResponse({ error: "You already own this property" }, 400);
          }

          // Look up user_id if already registered
          let matchedUserId: string | null = null;
          try {
            const { data: profile } = await dbClient
              .from("profiles")
              .select("id")
              .ilike("email", cleanEmail)
              .maybeSingle();
            if (profile) matchedUserId = profile.id;
          } catch {}

          let { data: priorEmailShare } = await dbClient
            .from("deal_shares")
            .select("id")
            .eq("deal_id", dealId)
            .eq("shared_with_email", cleanEmail)
            .maybeSingle();
          if (!priorEmailShare && matchedUserId) {
            // Older shares may carry only the user id.
            ({ data: priorEmailShare } = await dbClient
              .from("deal_shares")
              .select("id")
              .eq("deal_id", dealId)
              .eq("shared_with_user_id", matchedUserId)
              .maybeSingle());
          }

          const { data: shareRow, error: sErr } = await saveShare(dbClient, priorEmailShare?.id, {
            deal_id: dealId,
            owner_id: userId,
            group_id: null,
            shared_with_email: cleanEmail,
            shared_with_user_id: matchedUserId,
            permission,
            can_view_scenarios: canViewScenarios,
          });

          if (sErr) throw sErr;
          if (!priorEmailShare) {
            await notifyNewShare(dbClient, { dealId, ownerId: userId, ownerEmail: userEmail, permission, recipients: [cleanEmail] });
          }
          return jsonResponse({ success: true, share: shareRow, message: `Deal shared with ${cleanEmail}` });
        }
      }

      // 6. REVOKE DEAL SHARE
      case "revoke_share": {
        const shareId = (body.share_id as string) || (body.shareId as string);
        const dealId = (body.deal_id as string) || (body.dealId as string);
        const targetId = (body.target_id as string) || (body.targetId as string);

        let query = dbClient.from("deal_shares").delete().eq("owner_id", userId);
        if (shareId) {
          query = query.eq("id", shareId);
        } else if (dealId && targetId) {
          // targetId is a group uuid or an email; reject anything else so it cannot add filter clauses to the .or() string.
          if (!/^[A-Za-z0-9@._+-]+$/.test(targetId)) return jsonResponse({ error: "Invalid target" }, 400);
          query = query.eq("deal_id", dealId).or(`group_id.eq.${targetId},shared_with_email.eq.${targetId.toLowerCase()}`);
        } else {
          return jsonResponse({ error: "Share ID or Deal & Target ID required" }, 400);
        }

        const { error: revErr } = await query;
        if (revErr) throw revErr;
        return jsonResponse({ success: true, message: "Deal access revoked" });
      }

      // 6b. CHANGE A COLLABORATOR'S PERMISSION LEVEL (owner only)
      case "update_share": {
        const shareId = (body.share_id as string) || (body.shareId as string);
        const permission = body.permission as string;
        if (!shareId || (permission !== "viewer" && permission !== "editor")) {
          return jsonResponse({ error: "share_id and permission (viewer | editor) are required" }, 400);
        }
        const { data: updated, error: updErr } = await dbClient
          .from("deal_shares")
          .update({ permission, updated_at: new Date().toISOString() })
          .eq("id", shareId)
          .eq("owner_id", userId)
          .select()
          .maybeSingle();
        if (updErr) throw updErr;
        if (!updated) return jsonResponse({ error: "Share not found" }, 404);
        return jsonResponse({ success: true, share: updated });
      }

      // 6c. TRANSFER DEAL OWNERSHIP (current owner only). Runs rpc_transfer_deal_ownership as the caller (their JWT, not the
      // service role), so the database function sees auth.uid() and enforces owner-only, recipient-exists, etc. atomically.
      case "transfer_ownership": {
        const dealId = (body.deal_id as string) || (body.dealId as string);
        const recipientEmail = ((body.recipient_email as string) || (body.target_id as string) || "").trim();
        if (!dealId || !recipientEmail) {
          return jsonResponse({ error: "deal_id and recipient_email are required" }, 400);
        }
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
          global: { headers: { Authorization: authHeader || "" } },
        });
        const { data: result, error: rpcErr } = await userClient.rpc("rpc_transfer_deal_ownership", {
          p_deal_id: dealId,
          p_recipient_email: recipientEmail,
        });
        if (rpcErr) {
          // The database function raises a short code as the message (e.g. recipient_not_found).
          return jsonResponse({ success: false, error: rpcErr.message, code: rpcErr.code }, 400);
        }
        return jsonResponse({ success: true, ...(result as Record<string, unknown>) });
      }

      // 7. GET SHARES FOR A SPECIFIC DEAL
      case "get_deal_shares": {
        const dealId = (body.deal_id as string) || (body.dealId as string) || url.searchParams.get("deal_id");
        if (!dealId) return jsonResponse({ error: "deal_id parameter required" }, 400);
        if (!(await ownsDeal(dbClient, dealId, userId))) {
          return jsonResponse({ error: "Only the owner can view this property's shares" }, 403);
        }

        const { data: shares, error: shErr } = await dbClient
          .from("deal_shares")
          .select("id, deal_id, group_id, shared_with_email, shared_with_user_id, permission, can_view_scenarios, created_at, collaborator_groups(name)")
          .eq("deal_id", dealId);

        if (shErr) throw shErr;
        return jsonResponse({ success: true, shares: shares || [] });
      }

      default:
        return jsonResponse({ error: `Unknown action "${action}"` }, 400);
    }
  } catch (err: any) {
    console.error("[manage-collaboration] Edge function error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
}

function handleDemoCollaboration(action: string, body: Record<string, unknown>, url: URL): Response {
  const DEMO_GROUPS = [
    {
      id: "demo-grp-acq",
      name: "Acquisitions Committee",
      description: "Underwriting & investment partners",
      created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
      updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
      collaborator_group_members: [
        { id: "demo-m-1", member_email: "sarah.lin@apexcapital.internal" },
        { id: "demo-m-2", member_email: "marcus.vance@cascadeinvest.internal" },
      ],
    },
    {
      id: "demo-grp-equity",
      name: "LP Equity Partners",
      description: "Passive capital co-investors",
      created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
      updated_at: new Date(Date.now() - 86400000 * 5).toISOString(),
      collaborator_group_members: [
        { id: "demo-m-3", member_email: "elena.rostova@meridianfund.internal" },
      ],
    },
  ];

  if (action === "list_hub") {
    return jsonResponse({
      success: true,
      groups: DEMO_GROUPS,
      direct_collaborators: [
        { email: "sarah.lin@apexcapital.internal", deals_count: 2 },
        { email: "marcus.vance@cascadeinvest.internal", deals_count: 1 },
      ],
      shares_count: 2,
    });
  }

  return jsonResponse({ success: true, message: "Demo action simulated successfully" });
}

serve(handleRequest);
