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

#import "ProgressTracker.h"

/* Basic progress tracker for the ScanTask. It estimates progress based on the number of sub-folders
 * it has to scan for a given parent folder and the number of sub-folders scanned so far. It assumes
 * that each sub-folder requires the same time, which is not very accurate.
 */
@interface ScanProgressTracker : ProgressTracker {
  // The number of sub-folders at each level.
  NSUInteger  *numSubFolders;

  // The number of sub-folders processed sofar at each level.
  NSUInteger  *numSubFoldersProcessed;

  NSUInteger  maxLevels;
}

- (instancetype) initWithMaxLevel:(int)maxLevels NS_DESIGNATED_INITIALIZER;

/* Called by the scanning task to indicate how many sub-folders the current folder has. It should be
 * called before descending into any of these sub-folders.
 */
- (void) setNumSubFolders:(NSUInteger)numSubFolders;

@end
