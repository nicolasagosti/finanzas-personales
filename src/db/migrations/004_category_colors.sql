-- Cada categoría tiene un color fijo (la identidad sigue a la categoría, no a su
-- posición en el gráfico). Se guarda el nombre del color; el tono real para
-- modo claro/oscuro lo define la hoja de estilos.
alter table accounts add column color text
  check (color in ('blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'gray'));

with ranked as (
  select id, row_number() over (partition by user_id, kind order by name) as rn
  from accounts
  where kind in ('income', 'expense')
)
update accounts a
set color = (array['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red'])[((r.rn - 1) % 8) + 1]
from ranked r
where a.id = r.id;
