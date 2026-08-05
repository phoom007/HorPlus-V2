-- Foreign key constraints for subscription_status_histories
ALTER TABLE "subscription_status_histories" ADD CONSTRAINT "subscription_status_histories_dormitory_id_fkey" FOREIGN KEY ("dormitory_id") REFERENCES "dormitories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_status_histories" ADD CONSTRAINT "subscription_status_histories_previous_plan_id_fkey" FOREIGN KEY ("previous_plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_status_histories" ADD CONSTRAINT "subscription_status_histories_new_plan_id_fkey" FOREIGN KEY ("new_plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "subscription_status_histories" ADD CONSTRAINT "subscription_status_histories_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign key constraints for promo_redemptions
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_redeemed_by_fkey" FOREIGN KEY ("redeemed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Indexes for performance & audit tracking
CREATE INDEX "idx_sub_hist_actor_id" ON "subscription_status_histories"("actor_id");
CREATE INDEX "idx_promo_redemption_redeemed_by" ON "promo_redemptions"("redeemed_by");
