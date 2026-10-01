export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_notifications: {
        Row: {
          action_payload: Json | null
          action_type: string | null
          created_at: string
          deal_id: string | null
          id: string
          is_dismissed: boolean
          is_read: boolean
          message: string
          severity: string
          snoozed_until: string | null
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_payload?: Json | null
          action_type?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          message: string
          severity?: string
          snoozed_until?: string | null
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_payload?: Json | null
          action_type?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          is_dismissed?: boolean
          is_read?: boolean
          message?: string
          severity?: string
          snoozed_until?: string | null
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "app_notifications_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      collaborator_group_members: {
        Row: {
          created_at: string | null
          group_id: string
          id: string
          member_email: string
          member_user_id: string | null
        }
        Insert: {
          created_at?: string | null
          group_id: string
          id?: string
          member_email: string
          member_user_id?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string
          id?: string
          member_email?: string
          member_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collaborator_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "collaborator_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      collaborator_groups: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      deal_baselines: {
        Row: {
          baseline_type: string
          captured_at: string
          deal_id: string
          id: string
          inputs_snapshot: Json
          metrics_snapshot: Json
          projected_cash_flow: number | null
          projected_cash_on_cash: number | null
          projected_gross_rent_annual: number
          projected_irr: number | null
          projected_noi: number
          purchase_price: number | null
          user_id: string
        }
        Insert: {
          baseline_type?: string
          captured_at?: string
          deal_id: string
          id?: string
          inputs_snapshot?: Json
          metrics_snapshot?: Json
          projected_cash_flow?: number | null
          projected_cash_on_cash?: number | null
          projected_gross_rent_annual?: number
          projected_irr?: number | null
          projected_noi?: number
          purchase_price?: number | null
          user_id: string
        }
        Update: {
          baseline_type?: string
          captured_at?: string
          deal_id?: string
          id?: string
          inputs_snapshot?: Json
          metrics_snapshot?: Json
          projected_cash_flow?: number | null
          projected_cash_on_cash?: number | null
          projected_gross_rent_annual?: number
          projected_irr?: number | null
          projected_noi?: number
          purchase_price?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_baselines_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_baselines_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_baselines_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      deal_parameter_history: {
        Row: {
          category: string
          created_at: string
          deal_id: string
          id: string
          inputs: Json
          is_auto_run: boolean | null
          is_baseline: boolean
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          deal_id: string
          id?: string
          inputs?: Json
          is_auto_run?: boolean | null
          is_baseline?: boolean
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          created_at?: string
          deal_id?: string
          id?: string
          inputs?: Json
          is_auto_run?: boolean | null
          is_baseline?: boolean
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_parameter_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_parameter_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_parameter_history_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      deal_shares: {
        Row: {
          can_view_scenarios: boolean
          created_at: string
          deal_id: string
          group_id: string | null
          id: string
          owner_id: string
          permission: string
          shared_with_email: string | null
          shared_with_user_id: string | null
          updated_at: string
        }
        Insert: {
          can_view_scenarios?: boolean
          created_at?: string
          deal_id: string
          group_id?: string | null
          id?: string
          owner_id: string
          permission?: string
          shared_with_email?: string | null
          shared_with_user_id?: string | null
          updated_at?: string
        }
        Update: {
          can_view_scenarios?: boolean
          created_at?: string
          deal_id?: string
          group_id?: string | null
          id?: string
          owner_id?: string
          permission?: string
          shared_with_email?: string | null
          shared_with_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_shares_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_shares_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_shares_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "deal_shares_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "collaborator_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          asset_type: string
          created_at: string
          entity_id: string | null
          id: string
          inputs: Json
          is_demo: boolean | null
          location: string | null
          notes: string | null
          purchase_price: number | null
          scenario_tag: string | null
          status: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_type: string
          created_at?: string
          entity_id?: string | null
          id?: string
          inputs: Json
          is_demo?: boolean | null
          location?: string | null
          notes?: string | null
          purchase_price?: number | null
          scenario_tag?: string | null
          status?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_type?: string
          created_at?: string
          entity_id?: string | null
          id?: string
          inputs?: Json
          is_demo?: boolean | null
          location?: string | null
          notes?: string | null
          purchase_price?: number | null
          scenario_tag?: string | null
          status?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deals_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      entities: {
        Row: {
          created_at: string
          entity_type: string
          formation_date: string | null
          formation_state: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_type?: string
          formation_date?: string | null
          formation_state?: string | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          formation_date?: string | null
          formation_state?: string | null
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cam_reconciliations: {
        Row: {
          admin_fee_pct: number | null
          cap_applied: boolean
          cap_pct: number | null
          charge: number
          created_at: string
          deal_id: string
          estimates_paid: number
          id: string
          lease_id: string
          notes: string | null
          prior_year_billed: number | null
          settled_date: string | null
          share_pct: number
          status: string
          total_expenses: number
          true_up: number
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          admin_fee_pct?: number | null
          cap_applied?: boolean
          cap_pct?: number | null
          charge?: number
          created_at?: string
          deal_id: string
          estimates_paid?: number
          id?: string
          lease_id: string
          notes?: string | null
          prior_year_billed?: number | null
          settled_date?: string | null
          share_pct?: number
          status?: string
          total_expenses?: number
          true_up?: number
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          admin_fee_pct?: number | null
          cap_applied?: boolean
          cap_pct?: number | null
          charge?: number
          created_at?: string
          deal_id?: string
          estimates_paid?: number
          id?: string
          lease_id?: string
          notes?: string | null
          prior_year_billed?: number | null
          settled_date?: string | null
          share_pct?: number
          status?: string
          total_expenses?: number
          true_up?: number
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      utility_meters: {
        Row: {
          base_charge: number
          created_at: string
          deal_id: string
          id: string
          is_active: boolean
          label: string
          lease_id: string
          multiplier: number
          rate_per_unit: number
          term_id: string | null
          unit_of_measure: string
          updated_at: string
          user_id: string
          utility_type: string
        }
        Insert: {
          base_charge?: number
          created_at?: string
          deal_id: string
          id?: string
          is_active?: boolean
          label: string
          lease_id: string
          multiplier?: number
          rate_per_unit?: number
          term_id?: string | null
          unit_of_measure?: string
          updated_at?: string
          user_id: string
          utility_type?: string
        }
        Update: {
          base_charge?: number
          created_at?: string
          deal_id?: string
          id?: string
          is_active?: boolean
          label?: string
          lease_id?: string
          multiplier?: number
          rate_per_unit?: number
          term_id?: string | null
          unit_of_measure?: string
          updated_at?: string
          user_id?: string
          utility_type?: string
        }
        Relationships: []
      }
      meter_readings: {
        Row: {
          charge: number
          created_at: string
          current_reading: number
          deal_id: string
          id: string
          item_id: string | null
          lease_id: string
          meter_id: string
          note: string | null
          previous_reading: number
          reading_date: string
          usage: number
          user_id: string
        }
        Insert: {
          charge?: number
          created_at?: string
          current_reading: number
          deal_id: string
          id?: string
          item_id?: string | null
          lease_id: string
          meter_id: string
          note?: string | null
          previous_reading: number
          reading_date: string
          usage?: number
          user_id: string
        }
        Update: {
          charge?: number
          created_at?: string
          current_reading?: number
          deal_id?: string
          id?: string
          item_id?: string | null
          lease_id?: string
          meter_id?: string
          note?: string | null
          previous_reading?: number
          reading_date?: string
          usage?: number
          user_id?: string
        }
        Relationships: []
      }
      lease_recovery_items: {
        Row: {
          amount_actual: number | null
          amount_expected: number | null
          category: string
          created_at: string
          deal_id: string
          due_date: string
          id: string
          lease_id: string
          note: string | null
          paid_date: string | null
          term_id: string
          updated_at: string
          user_id: string
          verified: boolean
          verified_date: string | null
        }
        Insert: {
          amount_actual?: number | null
          amount_expected?: number | null
          category: string
          created_at?: string
          deal_id: string
          due_date: string
          id?: string
          lease_id: string
          note?: string | null
          paid_date?: string | null
          term_id: string
          updated_at?: string
          user_id: string
          verified?: boolean
          verified_date?: string | null
        }
        Update: {
          amount_actual?: number | null
          amount_expected?: number | null
          category?: string
          created_at?: string
          deal_id?: string
          due_date?: string
          id?: string
          lease_id?: string
          note?: string | null
          paid_date?: string | null
          term_id?: string
          updated_at?: string
          user_id?: string
          verified?: boolean
          verified_date?: string | null
        }
        Relationships: []
      }
      lease_recovery_terms: {
        Row: {
          basis: string
          category: string
          created_at: string
          deal_id: string
          expected_amount: number | null
          first_due_date: string
          frequency: string
          id: string
          is_active: boolean
          label: string
          lease_id: string
          mode: string
          notes: string | null
          share_pct: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          basis?: string
          category: string
          created_at?: string
          deal_id: string
          expected_amount?: number | null
          first_due_date: string
          frequency?: string
          id?: string
          is_active?: boolean
          label?: string
          lease_id: string
          mode?: string
          notes?: string | null
          share_pct?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          basis?: string
          category?: string
          created_at?: string
          deal_id?: string
          expected_amount?: number | null
          first_due_date?: string
          frequency?: string
          id?: string
          is_active?: boolean
          label?: string
          lease_id?: string
          mode?: string
          notes?: string | null
          share_pct?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      leases: {
        Row: {
          created_at: string
          deal_id: string
          escalation_frequency: string | null
          escalation_rate: number | null
          escalation_type: string | null
          grace_period_days: number | null
          id: string
          is_active: boolean
          is_subsidized: boolean
          last_rent_increase_date: string | null
          lease_end_date: string | null
          lease_start_date: string | null
          lease_type: string | null
          monthly_rent: number
          next_escalation_date: string | null
          notes: string | null
          notification_email: string | null
          payment_due_day: number | null
          previous_rent_amount: number | null
          security_deposit: number | null
          stabilization_exempt: boolean
          track_recoveries: boolean
          tenant_email: string | null
          tenant_name: string
          tenant_phone: string | null
          term_type: string
          unit_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          escalation_frequency?: string | null
          escalation_rate?: number | null
          escalation_type?: string | null
          grace_period_days?: number | null
          id?: string
          is_active?: boolean
          is_subsidized?: boolean
          last_rent_increase_date?: string | null
          lease_end_date?: string | null
          lease_start_date?: string | null
          lease_type?: string | null
          monthly_rent: number
          next_escalation_date?: string | null
          notes?: string | null
          notification_email?: string | null
          payment_due_day?: number | null
          previous_rent_amount?: number | null
          security_deposit?: number | null
          stabilization_exempt?: boolean
          track_recoveries?: boolean
          tenant_email?: string | null
          tenant_name: string
          tenant_phone?: string | null
          term_type?: string
          unit_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          escalation_frequency?: string | null
          escalation_rate?: number | null
          escalation_type?: string | null
          grace_period_days?: number | null
          id?: string
          is_active?: boolean
          is_subsidized?: boolean
          last_rent_increase_date?: string | null
          lease_end_date?: string | null
          lease_start_date?: string | null
          lease_type?: string | null
          monthly_rent?: number
          next_escalation_date?: string | null
          notes?: string | null
          notification_email?: string | null
          payment_due_day?: number | null
          previous_rent_amount?: number | null
          security_deposit?: number | null
          stabilization_exempt?: boolean
          track_recoveries?: boolean
          tenant_email?: string | null
          tenant_name?: string
          tenant_phone?: string | null
          term_type?: string
          unit_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "leases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "leases_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "units"
            referencedColumns: ["id"]
          },
        ]
      }
      parcels: {
        Row: {
          acres: number
          apn: string
          created_at: string
          deal_id: string
          formatted_apn: string | null
          id: string
          included: boolean
          is_primary: boolean
          legal_description: string | null
          market_imp_val: number
          market_land_val: number
          situs_address: string | null
          sqft: number | null
          total_assessed_val: number | null
          updated_at: string
          use_code: string | null
          user_id: string
          zoning: string | null
        }
        Insert: {
          acres?: number
          apn: string
          created_at?: string
          deal_id: string
          formatted_apn?: string | null
          id?: string
          included?: boolean
          is_primary?: boolean
          legal_description?: string | null
          market_imp_val?: number
          market_land_val?: number
          situs_address?: string | null
          sqft?: number | null
          total_assessed_val?: number | null
          updated_at?: string
          use_code?: string | null
          user_id: string
          zoning?: string | null
        }
        Update: {
          acres?: number
          apn?: string
          created_at?: string
          deal_id?: string
          formatted_apn?: string | null
          id?: string
          included?: boolean
          is_primary?: boolean
          legal_description?: string | null
          market_imp_val?: number
          market_land_val?: number
          situs_address?: string | null
          sqft?: number | null
          total_assessed_val?: number | null
          updated_at?: string
          use_code?: string | null
          user_id?: string
          zoning?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "parcels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parcels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "parcels_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      portfolios: {
        Row: {
          created_at: string
          deal_items: Json
          id: string
          name: string
          notes: string | null
          summary_metrics: Json | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deal_items?: Json
          id?: string
          name: string
          notes?: string | null
          summary_metrics?: Json | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deal_items?: Json
          id?: string
          name?: string
          notes?: string | null
          summary_metrics?: Json | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          alert_preferences: Json | null
          company_name: string | null
          created_at: string
          discount_rate: number | null
          email: string | null
          exit_cap_timing: string | null
          exit_year: number | null
          full_name: string | null
          id: string
          market_tier: string | null
          notification_email: string | null
          preferences: Json | null
          primary_entity_id: string | null
          property_class: string | null
          updated_at: string
        }
        Insert: {
          alert_preferences?: Json | null
          company_name?: string | null
          created_at?: string
          discount_rate?: number | null
          email?: string | null
          exit_cap_timing?: string | null
          exit_year?: number | null
          full_name?: string | null
          id: string
          market_tier?: string | null
          notification_email?: string | null
          preferences?: Json | null
          primary_entity_id?: string | null
          property_class?: string | null
          updated_at?: string
        }
        Update: {
          alert_preferences?: Json | null
          company_name?: string | null
          created_at?: string
          discount_rate?: number | null
          email?: string | null
          exit_cap_timing?: string | null
          exit_year?: number | null
          full_name?: string | null
          id?: string
          market_tier?: string | null
          notification_email?: string | null
          preferences?: Json | null
          primary_entity_id?: string | null
          property_class?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_primary_entity_id_fkey"
            columns: ["primary_entity_id"]
            isOneToOne: false
            referencedRelation: "entities"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_tokens: {
        Row: {
          action: string
          created_at: string
          deal_id: string
          expires_at: string
          id: string
          lease_id: string
          period_month: string
          token_hash: string
          used_at: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          deal_id: string
          expires_at: string
          id?: string
          lease_id: string
          period_month: string
          token_hash: string
          used_at?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          deal_id?: string
          expires_at?: string
          id?: string
          lease_id?: string
          period_month?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_tokens_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_tokens_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "reconciliation_tokens_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "reconciliation_tokens_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_tokens_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "view_monthly_rent_reconciliation"
            referencedColumns: ["lease_id"]
          },
        ]
      }
      rent_increases: {
        Row: {
          created_at: string
          deal_id: string
          effective_date: string
          id: string
          increase_amount: number | null
          increase_type: string
          is_applied: boolean
          lease_id: string
          new_rent: number | null
          notice_sent_date: string | null
          old_rent: number | null
          percentage_change: number | null
          reason: string | null
          scheduled_amount: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          effective_date: string
          id?: string
          increase_amount?: number | null
          increase_type?: string
          is_applied?: boolean
          lease_id: string
          new_rent?: number | null
          notice_sent_date?: string | null
          old_rent?: number | null
          percentage_change?: number | null
          reason?: string | null
          scheduled_amount?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          effective_date?: string
          id?: string
          increase_amount?: number | null
          increase_type?: string
          is_applied?: boolean
          lease_id?: string
          new_rent?: number | null
          notice_sent_date?: string | null
          old_rent?: number | null
          percentage_change?: number | null
          reason?: string | null
          scheduled_amount?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rent_increases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rent_increases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "rent_increases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "rent_increases_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rent_increases_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "view_monthly_rent_reconciliation"
            referencedColumns: ["lease_id"]
          },
        ]
      }
      rent_payments: {
        Row: {
          amount_due: number
          amount_paid: number | null
          created_at: string
          deal_id: string
          due_date: string
          id: string
          lease_id: string
          paid_date: string | null
          payment_method: string | null
          period_month: string
          reference_note: string | null
          snooze_until: string | null
          snoozed_at: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_due: number
          amount_paid?: number | null
          created_at?: string
          deal_id: string
          due_date: string
          id?: string
          lease_id: string
          paid_date?: string | null
          payment_method?: string | null
          period_month: string
          reference_note?: string | null
          snooze_until?: string | null
          snoozed_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_due?: number
          amount_paid?: number | null
          created_at?: string
          deal_id?: string
          due_date?: string
          id?: string
          lease_id?: string
          paid_date?: string | null
          payment_method?: string | null
          period_month?: string
          reference_note?: string | null
          snooze_until?: string | null
          snoozed_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rent_payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rent_payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "rent_payments_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "rent_payments_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "leases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rent_payments_lease_id_fkey"
            columns: ["lease_id"]
            isOneToOne: false
            referencedRelation: "view_monthly_rent_reconciliation"
            referencedColumns: ["lease_id"]
          },
        ]
      }
      units: {
        Row: {
          created_at: string
          deal_id: string
          id: string
          market_rent: number | null
          sqft: number | null
          status: string
          unit_number: string
          unit_type: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          id?: string
          market_rent?: number | null
          sqft?: number | null
          status?: string
          unit_number: string
          unit_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          id?: string
          market_rent?: number | null
          sqft?: number | null
          status?: string
          unit_number?: string
          unit_type?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "units_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "units_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "units_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
        ]
      }
    }
    Views: {
      view_deal_parcel_packages: {
        Row: {
          adjacent_parcel_count: number | null
          combined_assessed_value: number | null
          deal_id: string | null
          deal_title: string | null
          parcels: Json | null
          primary_parcel: Json | null
          total_improvement_value: number | null
          total_land_value: number | null
          total_package_acres: number | null
          total_package_sqft: number | null
          total_parcels: number | null
          user_id: string | null
        }
        Relationships: []
      }
      view_monthly_rent_reconciliation: {
        Row: {
          amount_paid: number | null
          contractual_rent: number | null
          current_period: string | null
          deal_id: string | null
          deal_title: string | null
          escalation_frequency: string | null
          escalation_rate: number | null
          escalation_type: string | null
          grace_period_days: number | null
          is_active: boolean | null
          lease_end_date: string | null
          lease_id: string | null
          lease_start_date: string | null
          next_escalation_date: string | null
          paid_date: string | null
          payment_due_day: number | null
          payment_id: string | null
          payment_method: string | null
          payment_status: string | null
          reference_note: string | null
          snooze_until: string | null
          snoozed_at: string | null
          tenant_email: string | null
          tenant_name: string | null
          tenant_phone: string | null
          unit_number: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_deal_parcel_packages"
            referencedColumns: ["deal_id"]
          },
          {
            foreignKeyName: "leases_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "view_property_management_stats"
            referencedColumns: ["deal_id"]
          },
        ]
      }
      view_property_management_stats: {
        Row: {
          annual_gross_rent: number | null
          deal_id: string | null
          monthly_rent_roll: number | null
          occupancy_rate: number | null
          occupied_units: number | null
          property_name: string | null
          property_status: string | null
          total_security_deposit: number | null
          total_units: number | null
          user_id: string | null
          vacant_units: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      confirm_rent_payment_by_token: {
        Args: { p_payment_method?: string; p_token: string }
        Returns: Json
      }
      execute_scheduled_rent_escalations: { Args: never; Returns: Json }
      hash_token: { Args: { p_token: string }; Returns: string }
      rpc_evaluate_deal_notifications: {
        Args: { p_user_id: string }
        Returns: {
          action_payload: Json
          action_type: string
          created_at: string
          is_dismissed: boolean
          is_read: boolean
          message: string
          notif_type: string
          notification_id: string
          severity: string
          target_deal_id: string
          title: string
        }[]
      }
      snooze_rent_payment_by_token: { Args: { p_token: string }; Returns: Json }
      trigger_monthly_gis_sync: { Args: never; Returns: Json }
      undo_rent_reconciliation: { Args: { p_token: string }; Returns: Json }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

// Explicit Convenience Types for Views and Relational Entities
export type DealParcelPackageView = Database['public']['Views']['view_deal_parcel_packages']['Row'];
export type MonthlyRentReconciliationView = Database['public']['Views']['view_monthly_rent_reconciliation']['Row'];
export type ParcelRow = Database['public']['Tables']['parcels']['Row'];
export type ParcelInsert = Database['public']['Tables']['parcels']['Insert'];
export type ParcelUpdate = Database['public']['Tables']['parcels']['Update'];
export type RentPaymentRow = Database['public']['Tables']['rent_payments']['Row'];
export type RentPaymentInsert = Database['public']['Tables']['rent_payments']['Insert'];
export type RentPaymentUpdate = Database['public']['Tables']['rent_payments']['Update'];
export type LeaseRow = Database['public']['Tables']['leases']['Row'];
export type UnitRow = Database['public']['Tables']['units']['Row'];
export type EntityRow = Database['public']['Tables']['entities']['Row'];
export type RentIncreaseRow = Database['public']['Tables']['rent_increases']['Row'];
export type RentIncreaseInsert = Database['public']['Tables']['rent_increases']['Insert'];
export type RentIncreaseUpdate = Database['public']['Tables']['rent_increases']['Update'];

export interface ScheduledUpcomingIncrease {
  id: string;
  lease_id: string;
  deal_id: string;
  deal_title: string;
  tenant_name: string;
  unit_number: string | null;
  effective_date: string;
  increase_type: 'percentage' | 'fixed_step' | 'cpi' | string;
  scheduled_amount: number | null;
  current_rent: number;
  old_rent: number | null;
  new_rent: number | null;
  projected_increase_amount: number;
  reason: string | null;
  is_applied: boolean;
  created_at: string;
}

export interface PortfolioOperationsSummary {
  success: boolean;
  user_id: string | null;
  is_demo: boolean;
  current_period: string;
  total_monthly_rent: number;
  total_annual_rent: number;
  active_leases_count: number;
  total_units: number;
  occupied_units: number;
  vacant_units: number;
  occupancy_rate: number;
  total_billed_current_month: number;
  total_collected_current_month: number;
  pending_collections_amount: number;
  pending_collections_count: number;
  upcoming_increases_count: number;
  scheduled_upcoming_increases: ScheduledUpcomingIncrease[];
}

