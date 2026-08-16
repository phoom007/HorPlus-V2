-- AlterTable: Add CHECK constraint on buildings.max_term_rent_installments (1..12)
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_max_term_rent_installments_check" CHECK ("max_term_rent_installments" >= 1 AND "max_term_rent_installments" <= 12);
