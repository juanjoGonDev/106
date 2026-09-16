do $$
begin
  if to_regprocedure('public.start_game_challenge_pointer_only_policy_v2(text,text,text,text,text,uuid,text)') is null then
    alter function public.start_game_challenge_pointer_only(text, text, text, text, text, uuid, text)
      rename to start_game_challenge_pointer_only_policy_v2;
  end if;

  if to_regprocedure('public.finish_game_attempt_pointer_only_policy_v2(uuid,integer,text,text,jsonb)') is null then
    alter function public.finish_game_attempt_pointer_only(uuid, integer, text, text, jsonb)
      rename to finish_game_attempt_pointer_only_policy_v2;
  end if;
end;
$$;

comment on function public.start_game_challenge_pointer_only_policy_v2(text, text, text, text, text, uuid, text) is
  'Pre-policy-v3 ranked start implementation preserved so integrity enforcement can wrap rather than replace league gates, quota reservations and challenge semantics.';
comment on function public.finish_game_attempt_pointer_only_policy_v2(uuid, integer, text, text, jsonb) is
  'Pre-policy-v3 ranked finish implementation preserved so integrity enforcement can wrap rather than duplicate authoritative timing and one-use semantics.';
