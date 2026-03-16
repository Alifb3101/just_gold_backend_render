# Deployment Checklist - Guest Cart System

**Version:** 1.0  
**Date:** March 16, 2026  
**Status:** Production Ready

---

## Pre-Deployment (Local Testing)

### Code Review
- [ ] Reviewed src/middlewares/identity.middleware.js changes
- [ ] Reviewed src/app.js CORS updates
- [ ] Reviewed src/controllers/auth.controller.js changes
- [ ] Reviewed database migration script

### Local Database Setup
- [ ] PostgreSQL running locally
- [ ] Connection string in .env configured
- [ ] Can connect to database: `psql $DATABASE_URL`

### Run Migration Locally
```bash
node scripts/migrate_guest_cart_support.js
```
- [ ] Migration completed successfully
- [ ] All indexes created
- [ ] Schema verified

### Run Tests Locally
```bash
node scripts/test_guest_cart.js --url http://localhost:5000
```
- [ ] All 8 tests passed
- [ ] Success rate: 100%
- [ ] No errors in output

### Local API Testing
```bash
# Test guest cart
curl -X POST http://localhost:5000/api/v1/cart \
  -H "Content-Type: application/json" \
  -H "X-Guest-Token: 550e8400-e29b-41d4-a716-446655440000" \
  -d '{"product_id": 5, "quantity": 1}'
```
- [ ] Returns 201 Created
- [ ] Item added successfully
- [ ] Same token returns same cart

### Verify Frontend Ready
- [ ] Frontend sends X-Guest-Token header
- [ ] Guest token stored in localStorage
- [ ] Token persists across page refresh
- [ ] All cart operations include X-Guest-Token

---

## Staging Deployment

### Environment Setup
- [ ] .env updated with FRONTEND_URL (staging domain)
- [ ] NODE_ENV set to development or staging
- [ ] CART_DEBUG set to true for logging
- [ ] DATABASE_URL points to staging database
- [ ] JWT_SECRET configured
- [ ] STRIPE keys updated

### Database Migration on Staging
```bash
# Via Render shell or deployment
node scripts/migrate_guest_cart_support.js
```
- [ ] Migration output shows success
- [ ] Database verified with proper schema

### Deploy Code to Staging
```bash
git add -A
git commit -m "feat: guest cart system"
git push origin staging
```
- [ ] Code pushed to repository
- [ ] Render auto-deploy triggered
- [ ] Build completed successfully
- [ ] No deployment errors in logs

### Smoke Tests on Staging
```bash
node scripts/test_guest_cart.js --url https://your-staging-api.onrender.com
```
- [ ] All tests pass on staging API
- [ ] Success rate: 100%
- [ ] Response times acceptable

### Verify CORS from Frontend Domain
```bash
# From staging frontend
curl -X OPTIONS https://your-staging-api/api/v1/cart \
  -H "Origin: https://your-staging-domain" \
  -H "Access-Control-Request-Headers: X-Guest-Token"
```
- [ ] CORS headers returned
- [ ] X-Guest-Token in allowed headers
- [ ] Correct origin echoed back

### End-to-End Testing on Staging
- [ ] Can add products as guest
- [ ] Cart persists across page refresh
- [ ] Can register new account
- [ ] Can login with guest cart
- [ ] Guest items merge into user cart
- [ ] No errors in staging logs

### Performance Testing on Staging
- [ ] Cart query time < 100ms
- [ ] Add to cart < 200ms
- [ ] Concurrent users: test with 10 simultaneous requests
- [ ] No database errors or warnings

---

## Production Deployment

### Final Code Review
- [ ] All changes reviewed by team lead
- [ ] Code passes linting and style checks
- [ ] No console.log statements left (except errors)
- [ ] CART_DEBUG set to false for production

### Backup Database
```bash
# Via Render dashboard or CLI
# Create backup before running migration
```
- [ ] Database backup created
- [ ] Backup verified and accessible

### Production Environment Configuration
- [ ] .env updated with production FRONTEND_URL
- [ ] FRONTEND_URL_ALT set (www version if applicable)
- [ ] NODE_ENV = production
- [ ] CART_DEBUG = false
- [ ] DATABASE_URL points to production database
- [ ] All secrets properly configured
- [ ] No hardcoded credentials anywhere

### Deploy Code to Production
```bash
git add -A
git commit -m "feat: guest cart system - production release"
git push origin main
```
- [ ] Code pushed to main branch
- [ ] Render deployment triggered
- [ ] Build completed successfully
- [ ] No errors in build logs

### Run Production Migration
```bash
# Via Render shell
node scripts/migrate_guest_cart_support.js
```
- [ ] Migration succeeded
- [ ] All indexes created
- [ ] Schema verified
- [ ] No table locks remaining

### Verify Production Deployment
```bash
# Check API health
curl -X GET https://your-api.onrender.com/

# Verify CORS
curl -X OPTIONS https://your-api.onrender.com/api/v1/cart \
  -H "Origin: https://yourdomain.com" \
  -H "Access-Control-Request-Headers: X-Guest-Token"
```
- [ ] API responds with correct status
- [ ] CORS headers present
- [ ] X-Guest-Token allowed

### Run Production Smoke Tests
```bash
node scripts/test_guest_cart.js --url https://your-api.onrender.com
```
- [ ] All tests pass
- [ ] Response times acceptable
- [ ] No errors reported

### Monitor Production Logs
- [ ] Check Render dashboard for errors
- [ ] Monitor cart-related logs
- [ ] Check database connection logs
- [ ] No panic or critical errors

### Test Critical Flows
- [ ] Can add items as guest (via live frontend)
- [ ] Guest cart persists (refresh page)
- [ ] Guest items visible (same token)
- [ ] Guest to user merge works
- [ ] Authenticated users still work
- [ ] Existing carts not affected

---

## Post-Deployment Monitoring (24 hours)

### Watch Metrics
- [ ] Database CPU: < 80%
- [ ] Database connections: < 30
- [ ] API response time: < 500ms (p95)
- [ ] Error rate: < 1%
- [ ] Cart operations: working normally

### Check Logs
- [ ] No guests experiencing errors
- [ ] No merge failures
- [ ] No index-related warnings
- [ ] No CORS issues reported

### User Feedback
- [ ] No guest checkout complaints
- [ ] No cart persistence issues
- [ ] No login/merge issues
- [ ] Performance seems acceptable

### Rollback Plan (If Needed)
```bash
# If critical issues, rollback code
git revert <commit-hash>
git push origin main

# DO NOT modify database schema in rollback
# Just revert code changes, schema can stay
```
- [ ] Know how to rollback if needed
- [ ] Have database backup ready
- [ ] Know how to contact Render support

---

## Post-Deployment (1 week)

### Production Validation
- [ ] Cart operations working perfectly
- [ ] Guest to user merge successful
- [ ] No guest data loss
- [ ] All test scenarios verified

### Performance Analysis
- [ ] Database indexes being used
- [ ] Query times optimized
- [ ] No slow queries in logs
- [ ] Resource usage normal

### Security Audit
- [ ] CORS properly restricted
- [ ] No XSS vulnerabilities
- [ ] Guest tokens not exposed
- [ ] Database access controlled

### Documentation Update
- [ ] Update RUNBOOK with guest cart procedures
- [ ] Document any production quirks
- [ ] Add monitoring alerts
- [ ] Train team on troubleshooting

### Cleanup
- [ ] Remove CART_DEBUG=true from logs
- [ ] Remove test files from production
- [ ] Archive old migration scripts (keep one version)
- [ ] Update API documentation

---

## Rollback Procedure (If Needed)

### Immediate Rollback
```bash
# 1. Revert code to previous version
git revert <guest-cart-commit-hash>
git push origin main

# 2. Render will auto-deploy previous version
# 3. Monitor logs for stability

# DO NOT run rollback migration on database
# The schema changes are forward-compatible
```

### Full Rollback (Nuclear Option)
```bash
# 1. Delete guest_token column (CAREFUL!)
ALTER TABLE cart_items DROP COLUMN guest_token;

# 2. Drop all new indexes
DROP INDEX idx_cart_guest_token;
DROP INDEX ux_cart_guest_variant_not_null;
DROP INDEX ux_cart_guest_product_no_variant;
DROP INDEX idx_cart_guest_product;
DROP INDEX idx_cart_user_product;
DROP INDEX idx_cart_user_id;
DROP INDEX ux_cart_user_variant_not_null;
DROP INDEX ux_cart_user_product_no_variant;

# 3. Make user_id NOT NULL again (if needed)
ALTER TABLE cart_items ALTER COLUMN user_id SET NOT NULL;

# 4. Restore from backup if data corruption
```

---

## Success Criteria

✅ **All Deployments Should Have:**

- [ ] Zero guest cart related errors in production
- [ ] All 8 API tests passing
- [ ] Response times < 500ms (p95)
- [ ] Database queries using indexes
- [ ] No guest data loss
- [ ] Successful login merges
- [ ] Team confident with operations
- [ ] Documentation complete and accurate

✅ **Production Metrics Should Show:**

- [ ] 90%+ cart operation success rate
- [ ] < 1% error rate
- [ ] Average cart query time: 50-100ms
- [ ] Database CPU usage: < 70%
- [ ] No table lock warnings

---

## Communication Template

### Announcement (Pre-Deployment)
```
🚀 Deploying guest cart system
- Guest customers can now shop without account
- Seamless checkout experience
- Carts persist across sessions
- ETA: [time]
```

### Status Update (During)
```
🔄 Guest cart deployment in progress
- Database migration: [status]
- Code deployment: [status]
- Testing: [status]
- ETA: [time]
```

### Completion (Post-Deployment)
```
✅ Guest cart system is live!
- Guest customers can now add to cart
- Carts persist across sessions
- Login seamlessly merges guest carts
- No action needed from support team
```

---

## Emergency Contacts

- **Render Support:** https://render.com/support
- **Database Team:** [contact]
- **DevOps Lead:** [contact]
- **Product Manager:** [contact]

---

## Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Dev Lead | | | |
| QA Lead | | | |
| DevOps | | | |
| Product | | | |

---

**Last Updated:** March 16, 2026  
**Next Review:** After first production deployment  
**Version:** 1.0 - Initial Release
