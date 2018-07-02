const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const wmic = require('ms-wmic');

const promiseExec = promisify(exec);
const promiseProcessGet = promisify(wmic.process.get);

const setCwd = async ({ dispatch, action, tab }) => {
  const newCwd = await promiseExec(
    `lsof -p ${tab.pid} | grep cwd | tr -s ' ' | cut -d ' ' -f9-`);
  const cwd = newCwd.trim();
  dispatch({
    type: 'SESSION_SET_CWD',
    cwd,
  });
};

// For Windows Support:
// the final excluded character () is an odd character
// that was added to the end of the line by posh-hg/posh-git
const directoryRegex = /([a-zA-Z]:[^\:\[\]\?\"\<\>\|]+)/mi;

// For Git-Bash support
const gitBashExecutableRegex = /[\w:\\\s]+\\(sh|git-bash|bash|git-cmd)\.exe/gi;

/**
 * Determines whether or not the given path points to an executable related to git-bash / git for windows
 * @param {string} executablePath the path to the executable
 */
var isGitBashExecutable = (executablePath) => {
  return gitBashExecutableRegex.test(executablePath);
};

/**
 * Finds the PID of the bash process running within git-bash based on the wrapper-process's (git-cmd / git-bash) PID
 * @param {int} wrapperPid the process id (PID) of the wrapping process (git-cmd / git-bash)
 */
var getBashProcessFromWrapperPid = async (wrapperPid) => {
  console.log(wrapperPid);
  const processes = await promiseProcessGet({
    where: { parentprocessid: wrapperPid },
    get: ['name', 'executablePath', 'processid', 'parentprocessid']
  });

  // if there's more than one subprocess, select the first one running "bash.exe"
  var bashProcess = processes.filter((process) => process.Name === "bash.exe").shift();

  if (!bashProcess) {
    throw `Could not find any child bash process for PID ${wrapperPid}`;
  }

  return bashProcess;
};

const windowsSetCwd = ({ dispatch, action, tab }) => {

  if (!tab) return;

  var setCwd = (cwd) => {
    if (tab.cwd !== cwd) {
      dispatch({
        type: 'SESSION_SET_CWD',
        cwd,
      });
    }
    tab.cwd = cwd;
  };

  // check if we're in git bash case since we need to handle this case
  // specifically to get the current shell's cwd. Otherwise use the default logic
  if (isGitBashExecutable(action.shell)) {
    // In order to find the cwd of a running bash process we'll first need to find
    // the actual pid as known by mingw/msys/cygwin from the pid that we've got from
    // hyper which is the pid of the "wrapping" *.exe process
    getBashProcessFromWrapperPid(tab.pid).then(process => {
      // now get the actual cwd for this process using the /proc virtual directory
      // in the same folder where the bash excecutable resides, there should be the readlink command
      // we'll use readlink to find out what the current cwd is for the given process
      var executableDirectory = path.dirname(path.resolve(process.ExecutablePath));
      const readlinkExecutablePath = path.join(executableDirectory, "readlink.exe");
      const cygpathExecutablePath = path.join(executableDirectory, "cygpath.exe");
      promiseExec(`"${readlinkExecutablePath}" -e /proc/${process.ProcessId}/cwd`)
        .then(unixCwd => {
          return promiseExec(`"${cygpathExecutablePath}" --dos ${unixCwd}`);
        })
        .then(windowsCwd => {
          setCwd(windowsCwd);
        });
    });
  } else {
    const newCwd = directoryRegex.exec(action.data);
    if (newCwd) {
      setCwd(newCwd[0]);
    }
  }
};

module.exports = {
  setCwd,
  windowsSetCwd,
}
