alter table public.game_players
  add constraint game_players_nickname_shape_check
  check (
    char_length(nick) between 3 and 24
    and char_length(nick_key) between 3 and 24
    and nick !~ '[[:cntrl:]/\\]'
    and nick_key !~ '[[:cntrl:]/\\]'
    and nick ~ '[[:alnum:]]'
    and nick_key ~ '[[:alnum:]]'
    and nick !~ '^[[:space:]_.''’-]'
    and nick !~ '[[:space:]_.''’-]$'
    and nick !~ '[[:space:]_.''’-]{2,}'
    and nick_key !~ '^[[:space:]_.''’-]'
    and nick_key !~ '[[:space:]_.''’-]$'
    and nick_key !~ '[[:space:]_.''’-]{2,}'
    and position(chr(8203) in nick) = 0
    and position(chr(8204) in nick) = 0
    and position(chr(8205) in nick) = 0
    and position(chr(8206) in nick) = 0
    and position(chr(8207) in nick) = 0
    and position(chr(8234) in nick) = 0
    and position(chr(8235) in nick) = 0
    and position(chr(8236) in nick) = 0
    and position(chr(8237) in nick) = 0
    and position(chr(8238) in nick) = 0
    and position(chr(8288) in nick) = 0
    and position(chr(65279) in nick) = 0
  ) not valid;

comment on constraint game_players_nickname_shape_check on public.game_players is
  'Enforced for new and updated rows. Kept NOT VALID so malformed legacy rows are not destructively rewritten during rollout.';
