-- Al borrar un usuario, las cascadas users → accounts y users → transactions → postings
-- corren como sentencias separadas. Con la verificación inmediata, la FK de asientos a
-- cuentas fallaba antes de que se borraran los asientos. Diferida, se verifica al COMMIT
-- (como el balance contable): sigue impidiendo borrar una cuenta con movimientos.
alter table postings
  alter constraint postings_account_id_user_id_currency_fkey deferrable initially deferred;
