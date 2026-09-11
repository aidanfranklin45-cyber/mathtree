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
      deals: {
        Row: {
          asset_type: string
          cash_on_cash: number | null
          created_at: string
          entity_id: string | null
          equity_multiple: number | null
          id: string
          inputs: Json
          irr: number | null
          is_demo: boolean | null
          location: string | null
          metrics: Json | null
          notes: string | null
          purchase_price: number | null
          scenario_tag: string | null
          status: string | null
          title: string
          total_equity: number | null
          updated_at: string
          user_id: string
          year1_cashflow: number | null
        }
        Insert: {
          asset_type: string
          cash_on_cash?: number | null
          created_at?: string
          entity_id?: string | null
          equity_multiple?: number | null
          id?: string
          inputs: Json
          irr?: number | null
          is_demo?: boolean | null
          location?: string | null
          metrics?: Json | null
          notes?: string | null
          purchase_price?: number | null
          scenario_tag?: string | null
          status?: string | null
          title: string
          total_equity?: number | null
          updated_at?: string
          user_id: string
          year1_cashflow?: number | null
        }
        Update: {
          asset_type?: string
          cash_on_cash?: number | null
          created_at?: string
          entity_id?: string | null
          equity_multiple?: number | null
          id?: string
          inputs?: Json
          irr?: number | null
          is_demo?: boolean | null
          location?: string | null
          metrics?: Json | null
          notes?: string | null
          purchase_price?: number | null
          scenario_tag?: string | null
          status?: string | null
          title?: string
          total_equity?: number | null
          updated_at?: string
          user_id?: string
          year1_cashflow?: number | null
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
          bank_name: string | null
          created_at: string
          ein: string | null
          formation_date: string | null
          formation_state: string | null
          id: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_name?: string | null
          created_at?: string
          ein?: string | null
          formation_date?: string | null
          formation_state?: string | null
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_name?: string | null
          created_at?: string
          ein?: string | null
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
          last_rent_increase_date: string | null
          lease_end_date: string | null
          lease_start_date: string
          lease_type: string | null
          monthly_rent: number
          next_escalation_date: string | null
          notes: string | null
          payment_due_day: number | null
          previous_rent_amount: number | null
          security_deposit: number | null
          tenant_email: string | null
          tenant_name: string
          tenant_phone: string | null
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
          last_rent_increase_date?: string | null
          lease_end_date?: string | null
          lease_start_date: string
          lease_type?: string | null
          monthly_rent: number
          next_escalation_date?: string | null
          notes?: string | null
          payment_due_day?: number | null
          previous_rent_amount?: number | null
          security_deposit?: number | null
          tenant_email?: string | null
          tenant_name: string
          tenant_phone?: string | null
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
          last_rent_increase_date?: string | null
          lease_end_date?: string | null
          lease_start_date?: string
          lease_type?: string | null
          monthly_rent?: number
          next_escalation_date?: string | null
          notes?: string | null
          payment_due_day?: number | null
          previous_rent_amount?: number | null
          security_deposit?: number | null
          tenant_email?: string | null
          tenant_name?: string
          tenant_phone?: string | null
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
          company_name: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          preferences: Json | null
          updated_at: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          preferences?: Json | null
          updated_at?: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          preferences?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      rent_increases: {
        Row: {
          created_at: string
          deal_id: string
          effective_date: string
          id: string
          increase_amount: number | null
          lease_id: string
          new_rent: number
          notice_sent_date: string | null
          old_rent: number
          percentage_change: number | null
          reason: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          deal_id: string
          effective_date: string
          id?: string
          increase_amount?: number | null
          lease_id: string
          new_rent: number
          notice_sent_date?: string | null
          old_rent: number
          percentage_change?: number | null
          reason?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          deal_id?: string
          effective_date?: string
          id?: string
          increase_amount?: number | null
          lease_id?: string
          new_rent?: number
          notice_sent_date?: string | null
          old_rent?: number
          percentage_change?: number | null
          reason?: string | null
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
          is_active: boolean | null
          lease_id: string | null
          paid_date: string | null
          payment_id: string | null
          payment_method: string | null
          payment_status: string | null
          reference_note: string | null
          tenant_name: string | null
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
      view_portfolio_aggregates: {
        Row: {
          avg_pipeline_irr: number | null
          blended_coc_yield: number | null
          blended_owned_ltv: number | null
          owned_count: number | null
          pipeline_count: number | null
          total_deal_count: number | null
          total_owned_cashflow: number | null
          total_owned_debt: number | null
          total_owned_equity: number | null
          total_owned_value: number | null
          total_pipeline_value: number | null
          user_id: string | null
        }
        Relationships: []
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
      rpc_get_debt_schedule: {
        Args: {
          p_amort_years?: number
          p_interest_rate: number
          p_loan_amount: number
          p_term_years: number
        }
        Returns: Json
      }
      rpc_recalculate_deal: {
        Args: { p_deal_id: string; p_new_inputs?: Json }
        Returns: Json
      }
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
} as const;

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

