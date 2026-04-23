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

#import "Item.h"
#import "ProgressTracker.h"

/* Basic progress tracker for tasks that process an existing FileItem tree. It estimates progress
 * based on the number of files processed so-far given the total number of files to process. As it
 * works on an existing tree, the estimates are quite accurate. The main inaccuracies are caused
 * when the visiting task causes large folders of the input tree to be skipped (e.g. due to an
 * active filter).
 */
@interface TreeVisitingProgressTracker : ProgressTracker {
  // The number of files in the input tree at each level
  file_count_t  numFiles[NUM_PROGRESS_ESTIMATE_LEVELS];

  // The number of processed files in the input tree at each level
  file_count_t  numFilesProcessed[NUM_PROGRESS_ESTIMATE_LEVELS];
}
@end
