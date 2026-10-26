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
      agents: {
        Row: {
          auto_detect_language: boolean
          automations: Json
          business_name: string
          capture_fields: Json
          created_at: string
          direction: string
          end_call_phrases: string[]
          first_message_mode: string
          greeting: string
          id: string
          industry: string | null
          interruption_threshold_ms: number
          knowledge_base: string | null
          languages: string[]
          llm_model: string
          llm_provider: string
          llm_temperature: number
          max_duration_sec: number
          name: string
          silence_timeout_ms: number
          status: string
          stt_model: string
          stt_provider: string
          system_prompt: string
          tone: string
          tts_model: string
          tts_provider: string
          tts_voice_id: string
          updated_at: string
          use_realtime: boolean
          user_id: string
          voice_id: string
          voice_name: string
          voice_style: string | null
        }
        Insert: {
          auto_detect_language?: boolean
          automations?: Json
          business_name: string
          capture_fields?: Json
          created_at?: string
          direction: string
          end_call_phrases?: string[]
          first_message_mode?: string
          greeting: string
          id?: string
          industry?: string | null
          interruption_threshold_ms?: number
          knowledge_base?: string | null
          languages?: string[]
          llm_model?: string
          llm_provider?: string
          llm_temperature?: number
          max_duration_sec?: number
          name: string
          silence_timeout_ms?: number
          status?: string
          stt_model?: string
          stt_provider?: string
          system_prompt: string
          tone?: string
          tts_model?: string
          tts_provider?: string
          tts_voice_id?: string
          updated_at?: string
          use_realtime?: boolean
          user_id: string
          voice_id?: string
          voice_name?: string
          voice_style?: string | null
        }
        Update: {
          auto_detect_language?: boolean
          automations?: Json
          business_name?: string
          capture_fields?: Json
          created_at?: string
          direction?: string
          end_call_phrases?: string[]
          first_message_mode?: string
          greeting?: string
          id?: string
          industry?: string | null
          interruption_threshold_ms?: number
          knowledge_base?: string | null
          languages?: string[]
          llm_model?: string
          llm_provider?: string
          llm_temperature?: number
          max_duration_sec?: number
          name?: string
          silence_timeout_ms?: number
          status?: string
          stt_model?: string
          stt_provider?: string
          system_prompt?: string
          tone?: string
          tts_model?: string
          tts_provider?: string
          tts_voice_id?: string
          updated_at?: string
          use_realtime?: boolean
          user_id?: string
          voice_id?: string
          voice_name?: string
          voice_style?: string | null
        }
        Relationships: []
      }
      calls: {
        Row: {
          agent_id: string | null
          campaign_id: string | null
          captured_fields: Json | null
          cost_inr: number
          created_at: string
          direction: string
          duration_sec: number
          ended_at: string | null
          from_number: string | null
          id: string
          language: string | null
          latency_ms: number | null
          lead_id: string | null
          outcome: string | null
          phone_number_id: string | null
          provider: string
          provider_call_id: string | null
          recording_url: string | null
          sentiment: string | null
          started_at: string | null
          status: string
          summary: string | null
          to_number: string
          transcript: Json | null
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          campaign_id?: string | null
          captured_fields?: Json | null
          cost_inr?: number
          created_at?: string
          direction: string
          duration_sec?: number
          ended_at?: string | null
          from_number?: string | null
          id?: string
          language?: string | null
          latency_ms?: number | null
          lead_id?: string | null
          outcome?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_call_id?: string | null
          recording_url?: string | null
          sentiment?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          to_number: string
          transcript?: Json | null
          user_id: string
        }
        Update: {
          agent_id?: string | null
          campaign_id?: string | null
          captured_fields?: Json | null
          cost_inr?: number
          created_at?: string
          direction?: string
          duration_sec?: number
          ended_at?: string | null
          from_number?: string | null
          id?: string
          language?: string | null
          latency_ms?: number | null
          lead_id?: string | null
          outcome?: string | null
          phone_number_id?: string | null
          provider?: string
          provider_call_id?: string | null
          recording_url?: string | null
          sentiment?: string | null
          started_at?: string | null
          status?: string
          summary?: string | null
          to_number?: string
          transcript?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "campaign_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_leads: {
        Row: {
          attempts: number
          campaign_id: string
          created_at: string
          id: string
          last_call_id: string | null
          last_error: string | null
          name: string | null
          next_dial_at: string | null
          outcome: string | null
          phone: string
          status: string
          updated_at: string
          user_id: string
          variables: Json
        }
        Insert: {
          attempts?: number
          campaign_id: string
          created_at?: string
          id?: string
          last_call_id?: string | null
          last_error?: string | null
          name?: string | null
          next_dial_at?: string | null
          outcome?: string | null
          phone: string
          status?: string
          updated_at?: string
          user_id: string
          variables?: Json
        }
        Update: {
          attempts?: number
          campaign_id?: string
          created_at?: string
          id?: string
          last_call_id?: string | null
          last_error?: string | null
          name?: string | null
          next_dial_at?: string | null
          outcome?: string | null
          phone?: string
          status?: string
          updated_at?: string
          user_id?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "campaign_leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_leads_last_call_id_fkey"
            columns: ["last_call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          active_hours_end: string
          active_hours_start: string
          agent_id: string
          completed: number
          connected: number
          created_at: string
          failed: number
          id: string
          max_attempts: number
          name: string
          notes: string | null
          opted_out: number
          phone_number_id: string | null
          retry_delay_min: number
          scheduled_at: string | null
          status: string
          timezone: string
          total: number
          updated_at: string
          user_id: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          active_hours_end?: string
          active_hours_start?: string
          agent_id: string
          completed?: number
          connected?: number
          created_at?: string
          failed?: number
          id?: string
          max_attempts?: number
          name: string
          notes?: string | null
          opted_out?: number
          phone_number_id?: string | null
          retry_delay_min?: number
          scheduled_at?: string | null
          status?: string
          timezone?: string
          total?: number
          updated_at?: string
          user_id: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          active_hours_end?: string
          active_hours_start?: string
          agent_id?: string
          completed?: number
          connected?: number
          created_at?: string
          failed?: number
          id?: string
          max_attempts?: number
          name?: string
          notes?: string | null
          opted_out?: number
          phone_number_id?: string | null
          retry_delay_min?: number
          scheduled_at?: string | null
          status?: string
          timezone?: string
          total?: number
          updated_at?: string
          user_id?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string
          delta_inr: number
          id: string
          kind: string
          note: string | null
          ref_call_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delta_inr: number
          id?: string
          kind: string
          note?: string | null
          ref_call_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delta_inr?: number
          id?: string
          kind?: string
          note?: string | null
          ref_call_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_ref_call_id_fkey"
            columns: ["ref_call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_docs: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          id: string
          kind: string
          size_chars: number
          source_url: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          content?: string
          created_at?: string
          id?: string
          kind?: string
          size_chars?: number
          source_url?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          id?: string
          kind?: string
          size_chars?: number
          source_url?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_docs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          agent_id: string | null
          created_at: string
          e164: string
          id: string
          is_verified: boolean
          label: string | null
          provider: string
          provider_config: Json
          sip_host: string | null
          sip_password: string | null
          sip_status: string
          sip_uri: string | null
          sip_username: string | null
          updated_at: string
          user_id: string
          verification_code: string | null
          verification_expires_at: string | null
          voxbiz_api_key: string | null
          voxbiz_api_url: string | null
          voxbiz_caller_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          e164: string
          id?: string
          is_verified?: boolean
          label?: string | null
          provider?: string
          provider_config?: Json
          sip_host?: string | null
          sip_password?: string | null
          sip_status?: string
          sip_uri?: string | null
          sip_username?: string | null
          updated_at?: string
          user_id: string
          verification_code?: string | null
          verification_expires_at?: string | null
          voxbiz_api_key?: string | null
          voxbiz_api_url?: string | null
          voxbiz_caller_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          e164?: string
          id?: string
          is_verified?: boolean
          label?: string | null
          provider?: string
          provider_config?: Json
          sip_host?: string | null
          sip_password?: string | null
          sip_status?: string
          sip_uri?: string | null
          sip_username?: string | null
          updated_at?: string
          user_id?: string
          verification_code?: string | null
          verification_expires_at?: string | null
          voxbiz_api_key?: string | null
          voxbiz_api_url?: string | null
          voxbiz_caller_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          business_name: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          business_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          business_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_credits: {
        Row: {
          balance_inr: number
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_inr?: number
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_inr?: number
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      voice_samples: {
        Row: {
          audio_base64: string
          created_at: string
          mime_type: string
          voice_name: string
        }
        Insert: {
          audio_base64: string
          created_at?: string
          mime_type?: string
          voice_name: string
        }
        Update: {
          audio_base64?: string
          created_at?: string
          mime_type?: string
          voice_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deduct_credits: {
        Args: {
          _amount: number
          _call_id?: string
          _note?: string
          _user_id: string
        }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      recharge_credits: { Args: { _amount: number }; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
