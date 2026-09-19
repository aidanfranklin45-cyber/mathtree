import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TICKET_FILENAME = '.evaluator_ticket.json';
const MAX_TICKET_AGE_MS = 5 * 60 * 1000; // 5 minutes

function getHeadCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch (err) {
    console.error('[Evaluator Gatekeeper] Failed to get current git commit:', err.message);
    return null;
  }
}

function verifyAndConsumeTicket() {
  console.log('\n======================================================');
  console.log('  🛡️  FIREBASE PRE-DEPLOY EVALUATOR GATEKEEPER');
  console.log('======================================================');

  // Emergency Human Override Check
  if (process.env.EMERGENCY_OVERRIDE === '1') {
    console.warn('⚠️  [EMERGENCY OVERRIDE DETECTED]: Bypassing Evaluator approval check by explicit operator mandate.');
    return true;
  }

  const currentCommit = getHeadCommit();
  if (!currentCommit) {
    console.error('❌ [DEPLOYMENT BLOCKED]: Unable to resolve current git HEAD.');
    process.exit(1);
  }

  const ticketPath = path.resolve(process.cwd(), TICKET_FILENAME);
  if (!fs.existsSync(ticketPath)) {
    console.error(`❌ [DEPLOYMENT BLOCKED]: No Evaluator Approval Ticket (${TICKET_FILENAME}) found.`);
    console.error('   MathTree live deployments are strictly gated by the Master Evaluator.');
    console.error('   Raw "firebase deploy" calls from agents or terminal are unauthorized.');
    console.error('   Deployments must be initiated via complete_task approval in MathTree Studio.\n');
    process.exit(1);
  }

  let ticket;
  try {
    ticket = JSON.parse(fs.readFileSync(ticketPath, 'utf-8'));
  } catch (err) {
    console.error('❌ [DEPLOYMENT BLOCKED]: Corrupt or unreadable Evaluator Approval Ticket.');
    fs.unlinkSync(ticketPath);
    process.exit(1);
  }

  // 1. Signature Check
  if (ticket.signature !== 'EVALUATOR_VERIFIED') {
    console.error('❌ [DEPLOYMENT BLOCKED]: Invalid ticket signature.');
    fs.unlinkSync(ticketPath);
    process.exit(1);
  }

  // 2. Commit Hash Match
  if (!ticket.approved_commit || !currentCommit.startsWith(ticket.approved_commit) && !ticket.approved_commit.startsWith(currentCommit)) {
    console.error(`❌ [DEPLOYMENT BLOCKED]: Commit mismatch!`);
    console.error(`   Ticket Approved Commit : ${ticket.approved_commit}`);
    console.error(`   Current HEAD Commit    : ${currentCommit}`);
    console.error('   The code has changed since the Master Evaluator approved the task.\n');
    fs.unlinkSync(ticketPath);
    process.exit(1);
  }

  // 3. Expiration Check
  const ticketTime = new Date(ticket.timestamp).getTime();
  const now = Date.now();
  if (isNaN(ticketTime) || (now - ticketTime) > MAX_TICKET_AGE_MS) {
    console.error(`❌ [DEPLOYMENT BLOCKED]: Evaluator ticket has expired (>5 minutes old).`);
    fs.unlinkSync(ticketPath);
    process.exit(1);
  }

  // 4. Ticket is valid — consume it (delete so it cannot be reused)
  try {
    fs.unlinkSync(ticketPath);
  } catch (err) {
    console.warn(`[Evaluator Gatekeeper] Warning: Could not delete consumed ticket: ${err.message}`);
  }

  console.log(`✅ [EVALUATOR APPROVED]: Task #${ticket.task_id || 'UNKNOWN'} approved for commit ${currentCommit.slice(0, 7)}.`);
  console.log('   Proceeding with live deployment to Firebase Hosting...\n');
  return true;
}

verifyAndConsumeTicket();
