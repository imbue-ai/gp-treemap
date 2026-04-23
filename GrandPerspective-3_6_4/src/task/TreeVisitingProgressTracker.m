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

#import "TreeVisitingProgressTracker.h"

#import "DirectoryItem.h"

@interface TreeVisitingProgressTracker (PrivateMethods)

- (void) processedOrSkippedFolder:(DirectoryItem *)dirItem;

@end

@implementation TreeVisitingProgressTracker

- (void) _processingFolder:(DirectoryItem *)dirItem {
  [super _processingFolder: dirItem];

  NSUInteger level = self.level;
  if (level <= NUM_PROGRESS_ESTIMATE_LEVELS) {
    numFiles[level - 1] = dirItem.numFiles;
    numFilesProcessed[level - 1] = 0;
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
  NSUInteger level = self.level;
  if (level == 0) {
    // Abort to avoid dividing by uninitialized numFiles[0]
    return 0;
  }

  NSUInteger i = 0;
  NSUInteger max_i = MIN(level, NUM_PROGRESS_ESTIMATE_LEVELS - 1);
  file_count_t totalFilesProcessed = 0;
  while (i < max_i) {
    totalFilesProcessed += numFilesProcessed[i];
    i++;
  }
  float progress = 100.0 * totalFilesProcessed / numFiles[0];
  NSAssert(progress >= 0, @"Progress should be positive");
  NSAssert(progress <= 100, @"Progress should be less than 100");

  return progress;
}

@end


@implementation TreeVisitingProgressTracker (PrivateMethods)

- (void) processedOrSkippedFolder:(DirectoryItem *)dirItem {
  NSUInteger level = self.level;
  if (level > 0 && level <= NUM_PROGRESS_ESTIMATE_LEVELS) {
    numFilesProcessed[level - 1] += dirItem.numFiles;

    NSAssert(numFilesProcessed[level - 1] <= numFiles[level - 1],
             @"More files processed than expected.");
  }
}

@end
