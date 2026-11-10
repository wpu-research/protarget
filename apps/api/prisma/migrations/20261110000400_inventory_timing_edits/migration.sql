-- Only replace the two checks introduced by manual inventory. Original
-- dimension/positivity, identity, multiplier and audit constraints are untouched.
-- NOT VALID checks still run on every UPDATE, which blocks deactivation and
-- multiplier timeline locking of preserved legacy timing inconsistencies.
BEGIN;

ALTER TABLE "screens" DROP CONSTRAINT "screens_slot_within_loop";
ALTER TABLE "screens" DROP CONSTRAINT "screens_operating_hours_valid";

CREATE FUNCTION screens_validate_slot_within_loop() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."loopLengthSec" IS NOT DISTINCT FROM OLD."loopLengthSec"
       AND NEW."defaultSlotLengthSec" IS NOT DISTINCT FROM OLD."defaultSlotLengthSec" THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW."loopLengthSec" IS NOT NULL AND NEW."defaultSlotLengthSec" IS NOT NULL
     AND NEW."defaultSlotLengthSec" > NEW."loopLengthSec" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'screens_slot_within_loop',
      MESSAGE = 'Slot length must not exceed loop length';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER screens_slot_within_loop_on_edit
  BEFORE INSERT OR UPDATE ON "screens"
  FOR EACH ROW EXECUTE FUNCTION screens_validate_slot_within_loop();

CREATE FUNCTION screens_validate_operating_hours() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."operatingStart" IS NOT DISTINCT FROM OLD."operatingStart"
       AND NEW."operatingEnd" IS NOT DISTINCT FROM OLD."operatingEnd" THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW."operatingStart" IS NULL AND NEW."operatingEnd" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."operatingStart" IS NULL OR NEW."operatingEnd" IS NULL
     OR NEW."operatingStart" !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR NEW."operatingEnd" !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     OR NEW."operatingStart" = NEW."operatingEnd" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'screens_operating_hours_valid',
      MESSAGE = 'Operating hours must be a distinct HH:mm pair, or both null';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER screens_operating_hours_valid_on_edit
  BEFORE INSERT OR UPDATE ON "screens"
  FOR EACH ROW EXECUTE FUNCTION screens_validate_operating_hours();

COMMIT;
