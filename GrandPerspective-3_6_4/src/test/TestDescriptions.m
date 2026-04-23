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

#import "TestDescriptions.h"


NSString *descriptionForMatchTargets(NSArray *matchTargets) {
  NSEnumerator  *targetsEnum = [matchTargets objectEnumerator];

  // Can assume there is always one.
  NSString  *descr = [targetsEnum nextObject];

  NSString  *matchTarget = [targetsEnum nextObject];
  if (matchTarget) {
    // At least two match targets.
    NSString  *pairTemplate = 
      NSLocalizedStringFromTable(
        @"%@ or %@" , @"Tests", 
        @"Pair of match targets with 1: a target match, and 2: another target match");
      
    descr = [NSString stringWithFormat: pairTemplate, matchTarget, descr];

    NSString  *moreTemplate = 
      NSLocalizedStringFromTable(
        @"%@, %@" , @"Tests",
        @"Three or more match targets with 1: a target match, and 2: two or more other target matches");

    while (matchTarget = [targetsEnum nextObject]) {
      // Three or more
      descr = [NSString stringWithFormat: moreTemplate, matchTarget, descr];
    }
  }
  
  return descr;
}
