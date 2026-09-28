-- Login con Google (OpenID Connect): el usuario se identifica por el `sub`
-- del id_token, que es estable; el email puede cambiar.
alter table users add column google_sub text unique;
alter table users add column avatar_url text check (avatar_url is null or avatar_url ~ '^https://');
