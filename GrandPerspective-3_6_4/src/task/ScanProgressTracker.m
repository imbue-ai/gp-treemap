/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "ScanProgressTracker.h"

#import "DirectoryItem.h"

@interface ScanProgressTracker (PrivateMethods)

- (void) processedOrSkippedFolder:(DirectoryItem *)dirItem;

@end

@implementation ScanProgressTracker

// Override super's designated initialiser
- (instancetype) init {
  return [self initWithMaxLevel: NUM_PROGRESS_ESTIMATE_LEVELS];
}

// Designated initialiser
- (instancetype) initWithMaxLevel:(int)maxLevelsVal {
  if (self = [super init]) {
    maxLevels = maxLevelsVal;

    numSubFolders = (NSUInteger *) malloc(maxLevels * sizeof(NSUInteger));
    numSubFoldersProcessed = (NSUInteger *) malloc(maxLevels * sizeof(NSUInteger));
  }
  return self;
}

- (void) dealloc {
  free(numSubFolders);
  free(numSubFoldersProcessed);

  [super dealloc];
}

- (void) setNumSubFolders:(NSUInteger)num {
  [mutex lock];

  NSUInteger level = self.level;
  if (level <= maxLevels) {
    if (num > 0) {
      numSubFolders[level - 1] = num;
    } else {
      // Make both equal (and non-zero), to simplify calculation by estimatedProgress.
      numSubFoldersProcessed[level - 1] = numSubFolders[level - 1];
    }
  }

  [mutex unlock];
}

- (void) _processingFolder:(DirectoryItem *)dirItem {
  [super _processingFolder: dirItem];

  NSUInteger level = self.level;
  if (level <= maxLevels) {
    // Set to non-zero until actually set by setNumSubFolders, to simplify calculation by
    // estimatedProgress.
    numSubFolders[level - 1] = 1;
    numSubFoldersProcessed[level - 1] = 0;
  }
}

- (void) _processedFolder:(DirectoryItem *)dirItem {
  [super _processedFolder: dirItem];
  [self processedOrSkippedFolder: dirItem];
}

- (void) _skippedFolder:(DirectoryItem *)dirItem {
  [super _skippedFolder: dirItem];
  [self processedOrSkippedFolder: dirItem];
}

- (float) estimatedProgress {
  float progress = 0;
  float fraction = 100;
  NSUInteger i = 0;
  NSUInteger max_i = MIN(self.level, maxLevels);
  while (i < max_i) {
    progress += fraction * numSubFoldersProcessed[i] / numSubFolders[i];
    fraction /= numSubFolders[i];
    i++;
  }

  return progress;
}

@end


@implementation ScanProgressTracker (PrivateMethods)

- (void) processedOrSkippedFolder:(DirectoryItem *)dirItem {
  NSUInteger level = self.level;
  if (level > 0 && level <= maxLevels) {
    if (numSubFoldersProcessed[level - 1] < numSubFolders[level - 1]) {
      numSubFoldersProcessed[level - 1] += 1;
    } else {
      // This can happen if a new folder is created while the scan is in progress. Ignore it to
      // avoid overestimation of progress.
      NSLog(@"More sub-folders processed than expected at %@", dirItem.parentDirectory.path);
    }
  }
}

@end
