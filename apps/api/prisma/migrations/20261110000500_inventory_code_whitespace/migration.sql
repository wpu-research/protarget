-- String.trim() removes ECMAScript WhiteSpace and LineTerminator characters,
-- not just U+0020. Preserve legacy spelling while enforcing the same edge
-- whitespace normalization for new and existing physical screen identifiers.
-- Rebuilding fails atomically if legacy rows now collide; never merge/rewrite them.
BEGIN;

DROP INDEX "screens_code_canonical_key";
CREATE UNIQUE INDEX "screens_code_canonical_key" ON "screens" (
  upper(btrim("screenId", U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))
);

COMMIT;
