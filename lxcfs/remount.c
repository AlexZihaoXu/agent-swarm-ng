/*
 * lxcfs-remount <pid> [refresh]: binds this container's LXCFS files over a running computer's /proc and /sys files.
 *
 * The computer controller runs it (docker exec) inside the privileged, host-PID lxcfs container. It never executes
 * anything from the computer: the source mounts are cloned here first (open_tree), then this process joins the
 * computer's user and mount namespaces and attaches them (move_mount). An earlier LXCFS bind at a path (alive, or
 * dead after an lxcfs restart) is detached first, so binds never pile up; nothing else is unmounted.
 * With `refresh`, a computer that has no LXCFS bind is left alone.
 *
 * Prints one line per file. Exit status: 0 bound, 1 a file failed, 2 usage, 3 lxcfs not ready (the computer was not
 * touched), 4 refresh found no LXCFS bind, 5 the computer's namespaces could not be joined.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/vfs.h>
#include <unistd.h>

#define FUSE_MAGIC 0x65735546
#define ROOT "/host/lxcfs/mnt"

static const char *const FILES[] = {
    "/proc/meminfo", "/proc/cpuinfo", "/proc/stat", "/proc/loadavg", "/proc/diskstats", "/sys/devices/system/cpu/online",
};
#define COUNT (sizeof FILES / sizeof *FILES)

static int ns_fd(const char *pid, const char *kind) {
  char path[64];
  snprintf(path, sizeof path, "/proc/%s/ns/%s", pid, kind);
  return open(path, O_RDONLY | O_CLOEXEC);
}

static int same_ns(int fd, const char *kind) {
  char path[64];
  struct stat a, b;
  snprintf(path, sizeof path, "/proc/self/ns/%s", kind);
  return fstat(fd, &a) == 0 && stat(path, &b) == 0 && a.st_ino == b.st_ino && a.st_dev == b.st_dev;
}

/* An LXCFS bind: a FUSE file, or one whose FUSE connection is gone. */
static int lxcfs_bound(const char *path) {
  struct statfs fs;
  int rc = statfs(path, &fs);
  return (rc != 0 && errno == ENOTCONN) || (rc == 0 && fs.f_type == FUSE_MAGIC);
}

int main(int argc, char **argv) {
  int refresh = argc == 3 && strcmp(argv[2], "refresh") == 0;
  if ((argc != 2 && !refresh) || !*argv[1] || strlen(argv[1]) > 10 ||
      strspn(argv[1], "0123456789") != strlen(argv[1])) {
    fprintf(stderr, "usage: lxcfs-remount <pid> [refresh]\n");
    return 2;
  }
  // Readable, not just present: a dead FUSE mount fails here, before the computer is touched.
  char probe[64];
  int meminfo = open(ROOT "/proc/meminfo", O_RDONLY | O_CLOEXEC);
  ssize_t got = meminfo < 0 ? -1 : read(meminfo, probe, sizeof probe);
  if (got <= 0 || strncmp(probe, "MemTotal:", 9) != 0) {
    fprintf(stderr, "lxcfs is not ready\n");
    return 3;
  }
  close(meminfo);
  int trees[COUNT];
  for (size_t i = 0; i < COUNT; i++) {
    char source[256];
    snprintf(source, sizeof source, ROOT "%s", FILES[i]);
    trees[i] = open_tree(AT_FDCWD, source, OPEN_TREE_CLONE | OPEN_TREE_CLOEXEC);
    struct mount_attr attr = {.attr_set = MOUNT_ATTR_RDONLY | MOUNT_ATTR_NOSUID | MOUNT_ATTR_NODEV | MOUNT_ATTR_NOEXEC};
    if (trees[i] < 0 || mount_setattr(trees[i], "", AT_EMPTY_PATH, &attr, sizeof attr) != 0) {
      fprintf(stderr, "lxcfs is not ready (%s): %s\n", FILES[i], strerror(errno));
      return 3;
    }
  }
  int user = ns_fd(argv[1], "user"), mnt = ns_fd(argv[1], "mnt");
  if (user < 0 || mnt < 0) {
    fprintf(stderr, "computer process %s is gone\n", argv[1]);
    return 5;
  }
  // Under sysbox the computer has its own user namespace, which owns its mounts; under runc it shares ours.
  if ((!same_ns(user, "user") && setns(user, CLONE_NEWUSER) != 0) || setns(mnt, CLONE_NEWNS) != 0) {
    fprintf(stderr, "cannot join the computer's namespaces: %s\n", strerror(errno));
    return 5;
  }
  if (refresh) {
    int bound = 0;
    for (size_t i = 0; i < COUNT; i++) bound |= lxcfs_bound(FILES[i]);
    if (!bound) {
      printf("not bound\n");
      return 4;
    }
  }
  int failed = 0;
  for (size_t i = 0; i < COUNT; i++) {
    for (int round = 0; round < 4 && lxcfs_bound(FILES[i]); round++)
      if (umount2(FILES[i], MNT_DETACH) != 0) break;
    if (move_mount(trees[i], "", AT_FDCWD, FILES[i], MOVE_MOUNT_F_EMPTY_PATH) != 0) {
      printf("failed %s: %s\n", FILES[i], strerror(errno));
      failed = 1;
    } else {
      printf("ok %s\n", FILES[i]);
    }
  }
  return failed;
}
