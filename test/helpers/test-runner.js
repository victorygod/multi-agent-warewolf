const fs = require('fs');
const path = require('path');
const { clearTestLogs, openRunLog, closeRunLog, logTestResult, createTestLogger, setTestLogPath, resetTestLogPath } = require('./test-logger');

const _state = { suites: [], currentSuite: null, batchMode: false };

function describe(name, fn) {
  const suite = { name, tests: [], beforeEachFn: null, afterEachFn: null };
  const prev = _state.currentSuite;
  _state.currentSuite = suite;
  fn();
  _state.suites.push(suite);
  _state.currentSuite = prev;
}

function it(name, fn) {
  if (!_state.currentSuite) throw new Error('it() must be inside describe()');
  _state.currentSuite.tests.push({ name, fn });
}

function beforeEach(fn) {
  if (!_state.currentSuite) throw new Error('beforeEach() must be inside describe()');
  _state.currentSuite.beforeEachFn = fn;
}

function afterEach(fn) {
  if (!_state.currentSuite) throw new Error('afterEach() must be inside describe()');
  _state.currentSuite.afterEachFn = fn;
}

function parseArgs(argv) {
  const args = { grep: null, file: null, dir: null, layer: null };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--grep': args.grep = argv[++i]; break;
      case '--file': args.file = argv[++i]; break;
      case '--dir': args.dir = argv[++i]; break;
      case '--layer': args.layer = argv[++i]; break;
    }
  }
  return args;
}

function collectTestFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(full));
    } else if (entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }
  return files;
}

function _resetSuites() {
  _state.suites = [];
  _state.currentSuite = null;
}

function _findCallerFile() {
  const stack = new Error().stack;
  const lines = stack.split('\n');
  for (const line of lines) {
    const match = line.match(/\(([^)]+\.test\.js):\d+:\d+\)/) ||
                  line.match(/at\s+([^\s(]+\.test\.js):\d+:\d+/);
    if (match) return path.resolve(match[1]);
  }
  return null;
}

async function _executeSuites(grepRegex, filePath) {
  let passed = 0, failed = 0, skipped = 0;
  const failures = [];

  for (const suite of _state.suites) {
    for (const test of suite.tests) {
      const fullName = `${suite.name} > ${test.name}`;
      if (grepRegex && !grepRegex.test(fullName)) {
        skipped++;
        continue;
      }

      try {
        if (suite.beforeEachFn) await suite.beforeEachFn();
        await test.fn();
        if (suite.afterEachFn) await suite.afterEachFn();
        passed++;
        console.log(`  ✓ ${test.name}`);
        logTestResult(filePath, suite.name, test.name, true);
      } catch (e) {
        if (suite.afterEachFn) {
          try { await suite.afterEachFn(); } catch (_) {}
        }
        failed++;
        failures.push({ file: filePath, suite: suite.name, test: test.name, error: e });
        console.log(`  ✗ ${test.name}`);
        console.log(`    ${e.message}`);
        logTestResult(filePath, suite.name, test.name, false, e);
      }
    }
  }

  return { passed, failed, skipped, failures };
}

function _setupTestLogging(filePath) {
  const testLogger = createTestLogger(filePath);
  setTestLogPath(testLogger.getLogPath());
  const origLog = console.log;
  const origErr = console.error;
  const _logs = [];
  console.log = (...args) => { _logs.push(args.map(String).join(' ')); origLog(...args); };
  console.error = (...args) => { _logs.push('[ERROR] ' + args.map(String).join(' ')); origErr(...args); };
  return { testLogger, origLog, origErr, _logs };
}

function _teardownTestLogging(testLogger, origLog, origErr, _logs) {
  resetTestLogPath();
  _logs.forEach(line => testLogger.info(line));
  console.log = origLog;
  console.error = origErr;
}

async function run() {
  if (_state.batchMode) return;

  clearTestLogs();
  openRunLog();

  const args = parseArgs(process.argv);
  const startTime = Date.now();
  let totalPassed = 0, totalFailed = 0, totalSkipped = 0;
  const allFailures = [];

  const grepRegex = args.grep ? new RegExp(args.grep, 'i') : null;

  const isBatchRunner = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

  if (isBatchRunner) {
    let files = [];
    if (args.file) {
      files = [path.resolve(args.file)];
    } else if (args.dir) {
      const dir = path.resolve(args.dir);
      if (args.layer === 'unit') {
        files = collectTestFiles(path.join(dir, 'unit'));
      } else if (args.layer === 'integration') {
        files = collectTestFiles(path.join(dir, 'integration'));
      } else {
        files = collectTestFiles(dir);
      }
    } else {
      const testDir = path.resolve(__dirname, '..');
      files = [
        ...collectTestFiles(path.join(testDir, 'unit')),
        ...collectTestFiles(path.join(testDir, 'integration'))
      ];
    }

    _state.batchMode = true;

    for (const file of files) {
      _resetSuites();
      delete require.cache[require.resolve(file)];

      const { testLogger, origLog, origErr, _logs } = _setupTestLogging(file);

      const rel = path.relative(process.cwd(), file);
      origLog(`\n▶ ${rel}`);

      let loadFailed = false;
      try {
        require(file);
      } catch (e) {
        console.log(`\n✗ 加载失败: ${path.relative(process.cwd(), file)}`);
        console.log(`  ${e.message}`);
        totalFailed++;
        allFailures.push({ file, suite: '(load)', test: '(load)', error: e });
        loadFailed = true;
      }

      if (!loadFailed) {
        const result = await _executeSuites(grepRegex, file);
        totalPassed += result.passed;
        totalFailed += result.failed;
        totalSkipped += result.skipped;
        allFailures.push(...result.failures);
      }

      _teardownTestLogging(testLogger, origLog, origErr, _logs);
    }

    _state.batchMode = false;
  } else {
    const callerFile = _findCallerFile();
    const { testLogger, origLog, origErr, _logs } = _setupTestLogging(callerFile || __filename);

    const result = await _executeSuites(grepRegex, callerFile || '(inline)');
    totalPassed += result.passed;
    totalFailed += result.failed;
    totalSkipped += result.skipped;
    allFailures.push(...result.failures);

    _teardownTestLogging(testLogger, origLog, origErr, _logs);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('─'.repeat(40));
  console.log(`通过: ${totalPassed}  失败: ${totalFailed}  跳过: ${totalSkipped}`);
  console.log(`耗时: ${elapsed}s`);
  console.log('─'.repeat(40));

  if (allFailures.length > 0) {
    console.log('');
    for (const f of allFailures) {
      const rel = typeof f.file === 'string' ? path.relative(process.cwd(), f.file) : f.file;
      console.log(`FAIL ${rel}`);
      console.log(`  ✗ ${f.suite} > ${f.test}`);
      console.log(`    ${f.error.message}`);
    }
    console.log('─'.repeat(40));
    process.exit(1);
  }

  closeRunLog();
  process.exit(totalFailed > 0 ? 1 : 0);
}

module.exports = { describe, it, beforeEach, afterEach, run };

if (require.main === module) {
  run();
}