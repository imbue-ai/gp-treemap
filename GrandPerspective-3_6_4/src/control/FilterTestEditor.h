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

#import <Cocoa/Cocoa.h>


@class FilterTestWindowControl;
@class FilterTestRepository;
@class FilterTest;


/* Helper class for editing filter tests. Its purpose and functionality is very similar to that of
 * the FilterEditor class.
 */
@interface FilterTestEditor : NSObject {
  FilterTestRepository  *testRepository;
  
  FilterTestWindowControl  *filterTestWindowControl;
}

- (instancetype) init;
- (instancetype) initWithFilterTestRepository:(FilterTestRepository *)testRepository NS_DESIGNATED_INITIALIZER;

/* Edits a new filter test. It returns the new test, or "nil" if the action was cancelled. It
 * updates the repository. The repository's NotifyingDictionary will fire an "objectAdded" event in
 * response.
 */
- (FilterTest *)createFilterTest;

/* Edits an existing test with the given name. The test should exist in the test repository. It
 * returns the modified test, or "nil" if the action was cancelled. It updates the filter in the
 * repository. Its NotifyingDictionary will fire the appropriate event(s) in response.
 */
- (FilterTest *)editFilterTestNamed:(NSString *)oldName;

@end
